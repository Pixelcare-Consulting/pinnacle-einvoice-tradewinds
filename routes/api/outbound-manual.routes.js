const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const csv = require('csv-parser');
const XLSX = require('xlsx');
const prisma = require('../../src/lib/prisma');
const { auth }  = require('../../middleware/index-prisma');
const { validateExcelFilename } = require('../../services/helpers/filenameValidator');
const { consumeExcelFile, previewExcelFile } = require('../../services/excel/excelConsumer');
const LHDNSubmitter = require('../../services/lhdn/lhdnSubmitter');
const { mapToLHDNFormat } = require('../../services/lhdn/lhdnMapper');
// Using LHDNSubmitter for submissions; token management is handled in token.service
// const { getTokenAsTaxPayer, submitDocument } = require('../../services/lhdn/einvoice-sdk');

// Configure multer for file upload
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = path.join(__dirname, '../../public/uploads/manual');

        // Create directory if it doesn't exist
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }

        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname);
        cb(null, 'flatfile-' + uniqueSuffix + ext);
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
    fileFilter: (req, file, cb) => {
        // Accept only csv and txt files
        const filetypes = /csv|txt/;
        const mimetype = filetypes.test(file.mimetype);
        const extname = filetypes.test(path.extname(file.originalname).toLowerCase());

        if (mimetype && extname) {
            return cb(null, true);
        }

        cb(new Error('Error: File upload only supports CSV and TXT files!'));
    }
});

// Configure multer for Excel file upload to SFTP directory
const excelStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = 'C:\\SFTPRoot_Consolidation\\Incoming';

        // Create directory if it doesn't exist
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }

        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        // Keep original filename for Excel files to maintain naming convention
        cb(null, file.originalname);
    }
});

const excelUpload = multer({
    storage: excelStorage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB for Excel files
    fileFilter: (req, file, cb) => {
        // Accept only Excel files
        const filetypes = /xlsx|xls/;
        const mimetype = file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
                        file.mimetype === 'application/vnd.ms-excel';
        const extname = filetypes.test(path.extname(file.originalname).toLowerCase());

        if (mimetype && extname) {
            return cb(null, true);
        }

        cb(new Error('Error: File upload only supports Excel files (.xlsx, .xls)!'));
    }
});

// API endpoint to validate Excel filename
router.post('/validate-excel-filename', [auth.isApiAuthenticated], async (req, res) => {
    try {
        const { filename } = req.body;

        if (!filename) {
            return res.status(400).json({
                isValid: false,
                error: 'Filename is required'
            });
        }

        const validation = validateExcelFilename(filename);
        res.json(validation);

    } catch (error) {
        console.error('Error validating Excel filename:', error);
        res.status(500).json({
            isValid: false,
            error: 'Error validating filename: ' + error.message
        });
    }
});

// API endpoint for uploading consolidated Excel files
router.post('/upload-consolidated', [auth.isApiAuthenticated, (req, res, next) => {
    req.startTime = Date.now();
    next();
}, excelUpload.single('file')], async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                error: 'No Excel file uploaded'
            });
        }

        // Validate filename format
        const filenameValidation = validateExcelFilename(req.file.originalname);
        if (!filenameValidation.isValid) {
            // Clean up uploaded file
            if (fs.existsSync(req.file.path)) {
                fs.unlinkSync(req.file.path);
            }

            return res.status(400).json({
                success: false,
                error: filenameValidation.error
            });
        }

        // Check for duplicate filename
        const existingFile = await prisma.wP_UPLOADED_EXCEL_FILES.findFirst({
            where: {
                filename: req.file.originalname,
                uploaded_by_user_id: req.user.id,
                processing_status: { not: 'error' }
            }
        });

        if (existingFile) {
            // Clean up uploaded file
            if (fs.existsSync(req.file.path)) {
                fs.unlinkSync(req.file.path);
            }

            return res.status(400).json({
                success: false,
                error: `File '${req.file.originalname}' has already been uploaded. Please use a different filename or delete the existing file first.`,
                duplicateFile: {
                    id: existingFile.id,
                    uploadDate: existingFile.upload_date,
                    status: existingFile.processing_status
                }
            });
        }

        // Process the Excel file and extract data
        const workbook = XLSX.readFile(req.file.path);
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

        // Get headers and data rows
        const headers = jsonData[0] || [];

        // Filter for rows that have actual invoice data (check for invoice number in column A - index 0)
        // Skip header rows and only count rows with numeric invoice numbers
        const dataRows = jsonData.slice(1).filter(row => {
            // Check if row has data and the first column (invoice number) is not empty
            if (!row || row.length === 0 || !row[0]) {
                return false;
            }

            const invoiceValue = String(row[0]).trim();

            // Skip empty values and header text
            if (invoiceValue === '' || invoiceValue === 'undefined') {
                return false;
            }

            // Skip header rows - check if it's a text header rather than a number
            if (invoiceValue.includes('Document') || invoiceValue.includes('Invoice_ID') || invoiceValue.includes('Reference') || invoiceValue.includes('Internal')) {
                return false;
            }

            // Only count rows with numeric invoice numbers (should be 10-digit numbers starting with 22)
            const numericValue = Number(invoiceValue);
            return !isNaN(numericValue) && numericValue > 1000000000; // 10-digit numbers
        });

        // Validate document count against LHDN limits (100 documents per submission)
        if (dataRows.length > 100) {
            // Clean up uploaded file
            if (fs.existsSync(req.file.path)) {
                fs.unlinkSync(req.file.path);
            }

            return res.status(400).json({
                success: false,
                error: `File contains ${dataRows.length} documents, which exceeds the LHDN limit of 100 documents per submission. Please split your file into smaller batches of 100 documents or fewer.`,
                documentCount: dataRows.length,
                maxAllowed: 100
            });
        }

        // Calculate totals
        let totalAmount = 0;
        let totalTaxAmount = 0;
        const invoiceTypes = {};

        dataRows.forEach(row => {
            // Assuming columns: Invoice No, Type, Currency, Total Amount, Tax Amount, Status
            const type = row[4] || 'Unknown'; // Type column
            const amount = parseFloat(row[6]) || 0; // Total Amount column
            const taxAmount = parseFloat(row[7]) || 0; // Tax Amount column

            totalAmount += amount;
            totalTaxAmount += taxAmount;

            invoiceTypes[type] = (invoiceTypes[type] || 0) + 1;
        });

        // Store file information in database
        const fileRecord = await prisma.wP_UPLOADED_EXCEL_FILES.create({
            data: {
                filename: req.file.originalname,
                original_filename: req.file.originalname,
                file_path: req.file.path,
                file_size: BigInt(req.file.size),
                uploaded_by_user_id: req.user.id,
                uploaded_by_name: req.user.username || req.user.FullName || 'Unknown',
                upload_date: new Date(),
                processing_status: 'Pending',
                invoice_count: dataRows.length,
                metadata: JSON.stringify({
                    headers,
                    totalAmount,
                    totalTaxAmount,
                    invoiceTypes,
                    filenameValidation
                }),
                processing_logs: JSON.stringify([{
                    timestamp: new Date(),
                    action: 'File uploaded and processed',
                    status: 'success',
                    details: `Processed ${dataRows.length} records`
                }])
            }
        });

        res.json({
            success: true,
            message: 'Excel file uploaded and processed successfully',
            data: {
                fileId: fileRecord.id.toString(),
                filename: req.file.originalname,
                recordsProcessed: dataRows.length,
                totalAmount,
                totalTaxAmount,
                invoiceTypes,
                filenameValidation,
                processingTime: Date.now() - req.startTime || 0,
                excelStructure: {
                    totalRows: dataRows.length,
                    previewRows: Math.min(dataRows.length, 10),
                    headers
                }
            }
        });

    } catch (error) {
        console.error('Error uploading consolidated Excel file:', error);

        // Clean up uploaded file on error
        if (req.file && fs.existsSync(req.file.path)) {
            try {
                fs.unlinkSync(req.file.path);
            } catch (cleanupError) {
                console.error('Error cleaning up file:', cleanupError);
            }
        }

        res.status(500).json({
            success: false,
            error: 'Error processing Excel file: ' + error.message
        });
    }
});

// API endpoint for uploading Excel template files
router.post('/upload-excel-template', [auth.isApiAuthenticated, excelUpload.single('excelFile')], async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                error: 'No Excel file uploaded'
            });
        }

        const filePath = req.file.path;
        const filename = req.file.originalname;
        const fileSize = req.file.size;

        console.log('Processing Excel file:', filename);
        console.log('File path:', filePath);
        console.log('File size:', fileSize);

        // Additional file validations
        const maxFileSize = 10 * 1024 * 1024; // 10MB
        if (fileSize > maxFileSize) {
            // Clean up uploaded file
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }

            return res.status(400).json({
                success: false,
                error: `File size (${(fileSize / 1024 / 1024).toFixed(2)}MB) exceeds maximum allowed size of 10MB`
            });
        }

        // Validate filename format
        const filenameValidation = validateExcelFilename(filename);
        if (!filenameValidation.isValid) {
            // Clean up uploaded file
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }

            return res.status(400).json({
                success: false,
                error: filenameValidation.error
            });
        }

        // Check for duplicate filename
        const existingFile = await prisma.wP_UPLOADED_EXCEL_FILES.findFirst({
            where: {
                filename: filename,
                uploaded_by_user_id: req.user.id,
                processing_status: { not: 'error' }
            }
        });

        if (existingFile) {
            // Clean up uploaded file
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }

            return res.status(400).json({
                success: false,
                error: `A file with the name "${filename}" has already been uploaded and processed. Please use a different filename or delete the existing file first.`
            });
        }

        // Save file metadata to database first
        const uploadedFile = await prisma.wP_UPLOADED_EXCEL_FILES.create({
            data: {
                filename: filename,
                original_filename: filename,
                file_path: filePath,
                file_size: BigInt(fileSize),
                invoice_count: 0, // Will be updated after processing
                processing_status: 'uploaded',
                uploaded_by_user_id: req.user.id,
                uploaded_by_name: req.user.fullName || req.user.username || 'Unknown User',
                upload_date: new Date(),
                metadata: JSON.stringify({
                    originalPath: filePath,
                    filenameValidation: filenameValidation
                })
            }
        });

        // Process Excel file using existing consumer
        const processingResult = await consumeExcelFile(filePath);

        if (!processingResult.success) {
            // Update database with error status
            await prisma.wP_UPLOADED_EXCEL_FILES.update({
                where: { id: uploadedFile.id },
                data: {
                    processing_status: 'error',
                    error_message: processingResult.error?.message || 'Failed to process Excel file',
                    processed_date: new Date()
                }
            });

            return res.status(400).json({
                success: false,
                error: processingResult.error?.message || 'Failed to process Excel file',
                fileId: uploadedFile.id
            });
        }

        // Store processed data temporarily (you might want to store this in database)
        const processedData = processingResult.processingResults || [];

        console.log(`Successfully processed ${processedData.length} invoices from Excel file`);

        // Update database with processing results
        await prisma.wP_UPLOADED_EXCEL_FILES.update({
            where: { id: uploadedFile.id },
            data: {
                invoice_count: processedData.length,
                processing_status: 'processed',
                processed_date: new Date(),
                processing_logs: JSON.stringify(processingResult.logs)
            }
        });

        // Store processed data in memory with session ID for immediate use
        const sessionId = uuidv4();
        excelDataStorage.set(sessionId, {
            data: processedData,
            filename: filename,
            userId: req.user.id,
            timestamp: new Date(),
            fileId: uploadedFile.id
        });

        res.json({
            success: true,
            message: `Excel file processed successfully. ${processedData.length} invoices found.`,
            data: processedData,
            filename: filename,
            fileId: uploadedFile.id,
            sessionId: sessionId,
            filenameValidation: filenameValidation,
            logs: processingResult.logs
        });

    } catch (error) {
        console.error('Excel upload error:', error);

        // Clean up uploaded file on error
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }

        res.status(500).json({
            success: false,
            error: 'Error processing Excel file: ' + error.message
        });
    }
});

// API endpoint for uploading flat files
router.post('/upload-flat-file', [auth.isApiAuthenticated, upload.single('file')], async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'No file uploaded' });
        }

        const filePath = req.file.path;
        const results = [];

        // Parse CSV file
        fs.createReadStream(filePath)
            .pipe(csv())
            .on('data', (data) => results.push(data))
            .on('end', async () => {
                try {
                    // Store data in database
                    const processedRecords = await storeDataInDatabase(results, req.user.id);

                    // Return success response
                    res.json({
                        success: true,
                        message: 'File uploaded and processed successfully',
                        recordsProcessed: processedRecords.length,
                        fileName: req.file.originalname
                    });
                } catch (dbError) {
                    console.error('Database error:', dbError);
                    res.status(500).json({
                        success: false,
                        message: 'Error processing file data',
                        error: dbError.message
                    });
                }
            });
    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({
            success: false,
            message: 'Error uploading file',
            error: error.message
        });
    }
});

// API endpoint to get flat file data
router.get('/flat-file-data', [auth.isApiAuthenticated], async (req, res) => {
    try {
        const flatFiles = await database.WP_FLATFILE.findAll({
            order: [['upload_date', 'DESC']],
            limit: 1000
        });

        res.json({
            success: true,
            data: flatFiles
        });
    } catch (error) {
        console.error('Error fetching flat file data:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching flat file data',
            error: error.message
        });
    }
});

// API endpoint to map flat file record to LHDN format
router.post('/map-flat-file/:id', [auth.isApiAuthenticated], async (req, res) => {
    try {
        const { id } = req.params;
        const mappingDetails = req.body;

        const updated = await database.WP_FLATFILE.update({
            is_mapped: true,
            mapping_details: JSON.stringify(mappingDetails),
            processed_by: req.user.id,
            processed_date: new Date()
        }, {
            where: { id }
        });

        if (updated[0] === 0) {
            return res.status(404).json({
                success: false,
                message: 'Record not found'
            });
        }

        res.json({
            success: true,
            message: 'Record mapped successfully'
        });
    } catch (error) {
        console.error('Error mapping flat file:', error);
        res.status(500).json({
            success: false,
            message: 'Error mapping flat file',
            error: error.message
        });
    }
});

// Temporary storage for Excel processed data (in production, use database or Redis)
const excelDataStorage = new Map();

// API endpoint to store Excel processed data temporarily
router.post('/store-excel-data', [auth.isApiAuthenticated], async (req, res) => {
    try {
        const { sessionId, data } = req.body;

        if (!sessionId || !data) {
            return res.status(400).json({
                success: false,
                error: 'Session ID and data are required'
            });
        }

        // Store data with expiration (1 hour)
        excelDataStorage.set(sessionId, {
            data: data,
            timestamp: Date.now(),
            userId: req.user.id
        });

        // Clean up expired data
        cleanupExpiredData();

        res.json({
            success: true,
            message: 'Excel data stored successfully'
        });

    } catch (error) {
        console.error('Error storing Excel data:', error);
        res.status(500).json({
            success: false,
            error: 'Error storing Excel data: ' + error.message
        });
    }
});

// API endpoint to submit Excel invoice to LHDN
router.post('/submit-excel-invoice-to-lhdn', [auth.isApiAuthenticated], async (req, res) => {
    try {
        const { invoiceId, sessionId, version = '1.0' } = req.body;

        if (!invoiceId) {
            return res.status(400).json({
                success: false,
                error: 'Invoice ID is required'
            });
        }

        console.log('Submitting Excel invoice to LHDN:', invoiceId);

        // Retrieve stored Excel data
        let invoiceData = null;
        if (sessionId && excelDataStorage.has(sessionId)) {
            const storedData = excelDataStorage.get(sessionId);
            if (storedData.userId === req.user.id) {
                invoiceData = storedData.data.find(inv =>
                    inv.header?.invoiceNo === invoiceId ||
                    `Excel-${storedData.data.indexOf(inv) + 1}` === invoiceId
                );
            }
        }

        if (!invoiceData) {
            return res.status(404).json({
                success: false,
                error: 'Invoice data not found. Please re-upload the Excel file.'
            });
        }

        try {
            // Initialize LHDN submitter
            const submitter = new LHDNSubmitter(req);

            // Transform single invoice to array format expected by mapper
            const processedData = [invoiceData];

            // Map to LHDN format
            const lhdnJson = mapToLHDNFormat(processedData, version);
            if (!lhdnJson) {
                throw new Error('Failed to map invoice data to LHDN format');
            }

            // Prepare document for submission
            const { payload, invoice_number } = await submitter.prepareDocumentForSubmission(lhdnJson, version);
            if (!payload) {
                throw new Error('Failed to prepare document for submission');
            }

            // Submit to LHDN
            const result = await submitter.submitToLHDNDocument(payload.documents);

            if (result.status === 'success') {
                res.json({
                    success: true,
                    message: 'Invoice submitted to LHDN successfully',
                    invoiceId: invoiceId,
                    submissionId: result.submissionId || uuidv4(),
                    timestamp: new Date().toISOString(),
                    lhdnResponse: result
                });
            } else {
                throw new Error(result.error?.message || 'LHDN submission failed');
            }

        } catch (submissionError) {
            console.error('LHDN submission error:', submissionError);
            res.status(400).json({
                success: false,
                error: 'LHDN submission failed: ' + submissionError.message,
                details: submissionError.details || null
            });
        }

    } catch (error) {
        console.error('Error submitting Excel invoice to LHDN:', error);
        res.status(500).json({
            success: false,
            error: 'Error submitting to LHDN: ' + error.message
        });
    }
});

// Helper function to clean up expired data
function cleanupExpiredData() {
    const oneHour = 60 * 60 * 1000; // 1 hour in milliseconds
    const now = Date.now();

    for (const [sessionId, data] of excelDataStorage.entries()) {
        if (now - data.timestamp > oneHour) {
            excelDataStorage.delete(sessionId);
        }
    }
}

// API endpoint to submit mapped flat file to LHDN
router.post('/submit-mapped-file/:id', [auth.isApiAuthenticated], async (req, res) => {
    try {
        const { id } = req.params;

        const record = await database.WP_FLATFILE.findOne({
            where: {
                id,
                is_mapped: true
            }
        });

        if (!record) {
            return res.status(404).json({
                success: false,
                message: 'Mapped record not found'
            });
        }

        const mappingDetails = JSON.parse(record.mapping_details || '{}');

        // TODO: Call LHDN submission API with mapped data
        // This would typically call the existing LHDN submission logic
        // with the transformed data

        // Update record status
        await record.update({
            status: 'Submitted',
            submission_id: uuidv4(),
            lhdn_response: JSON.stringify({ status: 'success', timestamp: new Date() })
        });

        res.json({
            success: true,
            message: 'Record submitted to LHDN successfully'
        });
    } catch (error) {
        console.error('Error submitting to LHDN:', error);
        res.status(500).json({
            success: false,
            message: 'Error submitting to LHDN',
            error: error.message
        });
    }
});

// API endpoint to create manual consolidated invoice
router.post('/create-manual', [auth.isApiAuthenticated], async (req, res) => {
    try {
        const {
            invoice_no,
            start_date,
            end_date,
            description,
            classification,
            tax_type,
            tax_rate,
            total_excl_tax,
            tax_amount,
            total_incl_tax,
            transactions,
            receipt_range,
            notes,
            supplier_info,
            line_items,
            is_multiple_line_items // Flag to indicate mode (optional)
        } = req.body;

        // Validate required fields
        if (!invoice_no || !start_date || !end_date ||
            !total_excl_tax || !total_incl_tax) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields'
            });
        }

        // Validate that we have at least one line item
        if (!line_items || line_items.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'At least one line item is required'
            });
        }

        // Prepare data for consolidated invoice
        const consolidatedData = {
            supplier_name: supplier_info?.company_name || 'Company Name',
            supplier_tin: supplier_info?.tin_number || 'T0000000',
            supplier_brn: supplier_info?.business_registration_number || 'BRN00000',
            supplier_sst: supplier_info?.sst_number || 'NA',
            supplier_address: supplier_info?.address || 'NA',
            supplier_city: supplier_info?.city || 'NA',
            supplier_state: supplier_info?.state || 'NA',
            supplier_country: supplier_info?.country || 'MYS',
            supplier_contact: supplier_info?.contact_number || 'NA',
            buyer_name: 'General Public',
            buyer_tin: 'EI00000000010',
            buyer_brn: 'NA',
            buyer_sst: 'NA',
            buyer_address: 'NA',
            buyer_city: 'NA',
            buyer_state: 'NA',
            buyer_country: 'NA',
            buyer_contact: 'NA',
            invoice_no: invoice_no,
            invoice_date: end_date, // End date is used as the invoice date for consolidated invoices
            invoice_time: '23:59:00Z',
            currency_code: 'MYR',
            exchange_rate: '1.0000',
            einvoice_version: '1.0',
            einvoice_type: '01', // Standard invoice
            item_description: description || (line_items && line_items.length > 0 ? line_items[0].description : ''),
            classification: classification || (line_items && line_items.length > 0 ? line_items[0].classification : ''),
            tax_type: tax_type || (line_items && line_items.length > 0 ? line_items[0].tax_type : ''),
            tax_rate: tax_rate || (line_items && line_items.length > 0 ? line_items[0].tax_rate : '0'),
            tax_amount: tax_amount,
            total_excl_tax: total_excl_tax,
            total_incl_tax: total_incl_tax,
            notes: notes,
            status: 'Pending',
            creation_type: 'Manual',
            billing_period_start: start_date,
            billing_period_end: end_date,
            transactions_count: transactions || line_items.length || 0,
            receipt_range: receipt_range || 'NA',
            processed_by: req.user.id,
            uuid: uuidv4()
        };

        // Save to database
        const newRecord = await database.WP_FLATFILE.create({
            ...consolidatedData,
            is_mapped: true,
            mapping_details: JSON.stringify({
                consolidationType: 'manual',
                classificationCode: classification === 'G4' ? '004' :
                                   classification === 'S1' ? '005' :
                                   classification === 'S2' ? '006' : '007',
                startDate: start_date,
                endDate: end_date,
                notes: notes,
                line_items: line_items || [],
                is_multiple_line_items: is_multiple_line_items || false
            }),
            upload_date: new Date()
        });

        // Log line items info
        if (line_items && line_items.length > 0) {
            console.log(`Saved ${line_items.length} line item(s) for invoice ${invoice_no}`);

            // You could log each line item for detailed information
            if (line_items.length === 1) {
                console.log(`Single line item: ${line_items[0].description}, Amount: ${line_items[0].amount}`);
            } else {
                console.log(`Multiple line items with total: ${total_incl_tax}`);
            }
        }

        res.json({
            success: true,
            message: 'Consolidated invoice created successfully',
            record: {
                id: newRecord.id,
                uuid: newRecord.uuid,
                invoice_no: newRecord.invoice_no,
                line_items: line_items.length
            }
        });
    } catch (error) {
        console.error('Error creating manual consolidated invoice:', error);
        res.status(500).json({
            success: false,
            message: 'Error creating manual consolidated invoice',
            error: error.message
        });
    }
});

// API endpoint to download CSV template
router.get('/download-template', [auth.isApiAuthenticated], (req, res) => {
    try {
        const templatePath = path.join(__dirname, '../../public/assets/templates/consolidation_template.csv');

        if (!fs.existsSync(templatePath)) {
            return res.status(404).json({
                success: false,
                message: 'Template file not found'
            });
        }

        res.download(templatePath, 'consolidation_template.csv');
    } catch (error) {
        console.error('Error downloading template:', error);
        res.status(500).json({
            success: false,
            message: 'Error downloading template',
            error: error.message
        });
    }
});

// API endpoint to get uploaded Excel files
router.get('/uploaded-files', [auth.isApiAuthenticated], async (req, res) => {
    try {
        const { page = 1, limit = 10, status, search } = req.query;
        const offset = (page - 1) * limit;

        // Build where clause
        const where = {
            uploaded_by_user_id: req.user.id // Only show files uploaded by current user
        };

        if (status && status !== 'all') {
            where.processing_status = status;
        }

        if (search) {
            where.OR = [
                { filename: { contains: search } },
                { original_filename: { contains: search } }
            ];
        }

        // Get files with pagination
        const [files, totalCount] = await Promise.all([
            prisma.wP_UPLOADED_EXCEL_FILES.findMany({
                where,
                orderBy: { upload_date: 'desc' },
                skip: parseInt(offset),
                take: parseInt(limit)
            }),
            prisma.wP_UPLOADED_EXCEL_FILES.count({ where })
        ]);

        // Convert BigInt to string for JSON serialization
        const serializedFiles = files.map(file => ({
            ...file,
            file_size: file.file_size.toString()
        }));

        res.json({
            success: true,
            data: serializedFiles,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total: totalCount,
                totalPages: Math.ceil(totalCount / limit)
            }
        });
    } catch (error) {
        console.error('Error fetching uploaded files:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch uploaded files'
        });
    }
});

// API endpoint to download Excel template
router.get('/download-excel-template', [auth.isApiAuthenticated], (req, res) => {
    try {
        const templatePath = path.join(__dirname, '../../public/templates/manual/070325_114429.xlsx');

        if (!fs.existsSync(templatePath)) {
            return res.status(404).json({
                success: false,
                message: 'Excel template file not found'
            });
        }

        res.download(templatePath, '070325_114429.xlsx');
    } catch (error) {
        console.error('Error downloading Excel template:', error);
        res.status(500).json({
            success: false,
            message: 'Error downloading Excel template',
            error: error.message
        });
    }
});

// API endpoint to list uploaded Excel files for table display
router.get('/list-fixed-paths', [auth.isApiAuthenticated], async (req, res) => {
    try {
        console.log('Fetching uploaded Excel files for user:', req.user.id);

        // Get uploaded Excel files for the current user
        const uploadedFiles = await prisma.wP_UPLOADED_EXCEL_FILES.findMany({
            where: {
                uploaded_by_user_id: req.user.id
            },
            orderBy: {
                upload_date: 'desc'
            }
        });

        console.log(`Found ${uploadedFiles.length} uploaded Excel files`);

        // Transform the data to match the table structure
        const transformedFiles = uploadedFiles.map((file, index) => {
            // Parse metadata to get additional information
            let metadata = {};
            try {
                metadata = JSON.parse(file.metadata || '{}');
            } catch (e) {
                console.warn('Failed to parse metadata for file:', file.filename);
                metadata = {};
            }

            // Try to read the simplified log file for detailed invoice data
            let invoiceDetails = [];
            try {
                const fs = require('fs');
                const path = require('path');

                // Look for simplified log file
                const logDir = path.join(__dirname, '..', '..', 'logs', 'excel-consumer');
                const baseFilename = file.filename.replace('.xlsx', '');

                // Find the most recent simplified log file for this Excel file
                const logFiles = fs.readdirSync(logDir).filter(f =>
                    f.startsWith(baseFilename) && f.includes('_simplified_')
                );

                if (logFiles.length > 0) {
                    // Get the most recent log file
                    const latestLogFile = logFiles.sort().pop();
                    const logPath = path.join(logDir, latestLogFile);

                    if (fs.existsSync(logPath)) {
                        const logData = JSON.parse(fs.readFileSync(logPath, 'utf8'));
                        if (logData.summary && logData.summary.invoices) {
                            invoiceDetails = logData.summary.invoices;
                        }
                    }
                }
            } catch (e) {
                console.warn('Failed to read simplified log for file:', file.filename, e.message);
            }

            // Extract invoice information from metadata or log data
            const totalAmount = invoiceDetails.reduce((sum, inv) => sum + (inv.totalAmount || 0), 0) || metadata.totalAmount || 0;
            const invoiceCount = invoiceDetails.length || file.invoice_count || 0;
            const filenameValidation = metadata.filenameValidation || {};

            // Format invoice numbers for display
            let invoiceNumberDisplay = `${invoiceCount} Invoice(s)`;
            if (invoiceDetails.length > 0) {
                const invoiceNumbers = invoiceDetails.map(inv => inv.invoiceNumber).join('\n');
                invoiceNumberDisplay = `${invoiceCount} Invoice(s)\n${invoiceNumbers}`;
            }

            // Format supplier names for display (support object or string)
            let supplierDisplay = file.uploaded_by_name || 'N/A';
            if (invoiceDetails.length > 0) {
                const supplierNames = invoiceDetails
                    .map(inv => typeof inv.supplier === 'object' ? (inv.supplier?.company || inv.supplier?.name) : inv.supplier)
                    .filter(s => s && s !== 'N/A');
                const uniqueSuppliers = [...new Set(supplierNames)];
                if (uniqueSuppliers.length === 0) {
                    supplierDisplay = 'N/A';
                } else if (uniqueSuppliers.length === 1) {
                    supplierDisplay = uniqueSuppliers[0];
                } else {
                    // Format for multiple suppliers: count line + supplier names
                    supplierDisplay = `${uniqueSuppliers.length} Supplier(s)\n${uniqueSuppliers.join('\n')}`;
                }
            }

            // Format receiver/buyer names for display (support object or string)
            let receiverDisplay = 'Multiple Recipients';
            if (invoiceDetails.length > 0) {
                const receiverNames = invoiceDetails
                    .map(inv => typeof inv.buyer === 'object' ? (inv.buyer?.company || inv.buyer?.name) : inv.buyer)
                    .filter(b => b && b !== 'N/A');
                const uniqueReceivers = [...new Set(receiverNames)];
                if (uniqueReceivers.length === 0) {
                    receiverDisplay = 'N/A';
                } else if (uniqueReceivers.length === 1) {
                    receiverDisplay = uniqueReceivers[0];
                } else {
                    // Format for multiple receivers: count line + receiver names
                    receiverDisplay = `${uniqueReceivers.length} Receiver(s)\n${uniqueReceivers.join('\n')}`;
                }
            }

            return {
                id: file.id,
                DT_RowId: `file_${file.id}`,

                // Table columns data
                fileName: file.filename,
                invoiceNumber: invoiceNumberDisplay,
                supplier: supplierDisplay,
                receiver: receiverDisplay,
                date: file.upload_date,
                invDateInfo: filenameValidation.parsedData?.formattedDate || 'N/A',
                status: file.processing_status,
                source: 'Excel Upload',
                totalAmount: totalAmount,

                // Additional data for actions and display
                originalFilename: file.original_filename,
                filePath: file.file_path,
                fileSize: file.file_size.toString(),
                uploadedBy: file.uploaded_by_name,
                uploadDate: file.upload_date,
                invoiceDetails: invoiceDetails, // Include detailed invoice data
                processedDate: file.processed_date,
                submittedDate: file.submitted_date,
                submissionUid: file.submission_uid,
                errorMessage: file.error_message,
                processingLogs: file.processing_logs,
                lhdnResponse: file.lhdn_response,
                metadata: metadata
            };
        });

        res.json({
            success: true,
            files: transformedFiles,
            total: transformedFiles.length
        });

    } catch (error) {
        console.error('Error fetching uploaded Excel files:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch uploaded Excel files',
            details: error.message
        });
    }
});

// Configure multer for temporary preview uploads
const previewStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        const tempDir = path.join(__dirname, '../../temp/preview');

        // Create directory if it doesn't exist
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }

        cb(null, tempDir);
    },
    filename: (req, file, cb) => {
        // Use timestamp to avoid conflicts
        const timestamp = Date.now();
        cb(null, `preview-${timestamp}-${file.originalname}`);
    }
});

const previewUpload = multer({
    storage: previewStorage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
    fileFilter: (req, file, cb) => {
        // Accept only Excel files
        const filetypes = /xlsx|xls/;
        const mimetype = file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
                        file.mimetype === 'application/vnd.ms-excel';
        const extname = filetypes.test(path.extname(file.originalname).toLowerCase());

        if (mimetype && extname) {
            return cb(null, true);
        }

        cb(new Error('Error: File upload only supports Excel files (.xlsx, .xls)!'));
    }
});

// API endpoint to preview Excel file data with full processing
router.post('/preview-excel', [auth.isApiAuthenticated, previewUpload.single('file')], async (req, res) => {
    let tempFilePath = null;

    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                error: 'No Excel file uploaded'
            });
        }

        tempFilePath = req.file.path;
        console.log(`[Preview API] Processing file: ${req.file.originalname}`);

        // Use the lighter preview service first, then do limited processing
        const { previewExcelFile } = require('../../services/excel/excelConsumer');
        const previewResult = await previewExcelFile(tempFilePath, {
            maxRows: 5, // Limit to 5 rows for preview
            originalFilename: req.file.originalname
        });

        // Clean up temp file
        if (fs.existsSync(tempFilePath)) {
            fs.unlinkSync(tempFilePath);
            tempFilePath = null;
        }

        if (previewResult.success) {
            // Calculate actual document count
            const documentsFound = Math.max(0, previewResult.preview.totalRows - 2); // Subtract header rows

            // Check document limit for preview warning
            const documentLimitExceeded = documentsFound > 100;

            // Create a simpler structured preview from the raw Excel data
            const structuredPreview = {
                filename: previewResult.filename,
                processingTime: previewResult.processingTime,
                filenameValidation: previewResult.filenameValidation,
                documentsFound: documentsFound,
                documentLimitExceeded: documentLimitExceeded,
                documentLimit: 100,
                isPreviewMode: true,
                previewNote: documentLimitExceeded ?
                    `⚠️ WARNING: This file contains ${documentsFound} documents, which exceeds the LHDN limit of 100 documents per submission. Upload will be blocked.` :
                    "This is a preview showing Excel structure. Full processing will happen during upload.",

                // Show Excel structure information
                excelStructure: {
                    totalRows: previewResult.preview.totalRows,
                    previewRows: previewResult.preview.previewRows,
                    headers: previewResult.preview.headers ? Object.values(previewResult.preview.headers).slice(0, 10) : [],
                    fieldMappings: previewResult.preview.fieldMappings ? Object.entries(previewResult.preview.fieldMappings).slice(0, 10) : [],
                    sampleData: previewResult.preview.sampleData ? previewResult.preview.sampleData.slice(0, 3) : []
                },

                // Create documents based on sample data for preview with actual values
                documents: previewResult.preview.sampleData ? previewResult.preview.sampleData.map((row, index) => {
                    // Map Excel columns to expected values based on the structure
                    const invoiceNo = row.Invoice || `Preview-${index + 1}`;
                    const invoiceType = row.__EMPTY_4 || '01'; // eInvoice Type Code
                    const currency = row.__EMPTY_5 || 'MYR'; // Document Currency Code
                    const exchangeRate = row.__EMPTY_7 || 1; // Currency Exchange Rate

                    // Extract supplier information
                    const supplierCompany = row.Supplier || 'TRADEWINDS INTERNATIONAL INSURANCE BROKERS SDN BHD';
                    const supplierTin = row.__EMPTY_12 || '213588D';
                    const supplierBrn = row.__EMPTY_13 || 'C4890799050';
                    const supplierSst = row.__EMPTY_14 || 'W10-1902-32000112';

                    // Extract buyer information
                    const buyerCompany = row.__EMPTY_16 || 'ETIQA GENERAL TAKAFUL BERHAD';
                    const buyerTin = row.__EMPTY_18 || '197001000276';
                    const buyerBrn = row.__EMPTY_19 || 'C862003020';
                    const buyerSst = row.__EMPTY_20 || 'W10-1808-31009769';

                    // Extract monetary totals - these are typically in the last columns
                    const totalAmount = row.__EMPTY_109 || row.__EMPTY_108 || row.__EMPTY_107 || 1000 * (index + 1);
                    const taxAmount = row.__EMPTY_110 || 0;
                    const taxRate = row.__EMPTY_111 || 8;

                    return {
                        documentNumber: index + 1,
                        invoiceNo: invoiceNo,
                        invoiceType: invoiceType,
                        currency: currency,
                        exchangeRate: exchangeRate,
                        isPreview: true,

                        supplier: {
                            company: supplierCompany,
                            industry: '66224',
                            industryName: 'TAKAFUL BROKER',
                            identifications: {
                                tin: supplierTin,
                                brn: supplierBrn,
                                sst: supplierSst,
                                ttx: 'NA'
                            },
                            address: '37TH FLOOR , MENARA AIA CAP SQUARE, NO 10, JALAN MUNSHI ABDULLAH',
                            city: 'KUALA LUMPUR',
                            state: 'Wilayah Persekutuan Kuala Lumpur',
                            postcode: '50100',
                            country: 'MYS',
                            phone: '60323804800',
                            email: 'e-invoicing@tradewindscorp-insbrok.com'
                        },

                        buyer: {
                            company: buyerCompany,
                            companyId: buyerBrn,
                            identifications: {
                                tin: buyerTin,
                                brn: buyerBrn,
                                sst: buyerSst,
                                ttx: 'NA'
                            },
                            address: 'GROUND FLOOR, TOWER B & C,DATARAN MAYBANK,, NO. 1,JALAN MAAROF,',
                            city: 'KUALA LUMPUR',
                            state: 'Wilayah Persekutuan Kuala Lumpur',
                            postcode: '59000',
                            country: 'MYS',
                            phone: '60327855225',
                            email: 'ikmalhs.ah@etiqa.com.my'
                        },

                        legalMonetaryTotal: {
                            lineExtensionAmount: totalAmount,
                            taxExclusiveAmount: totalAmount,
                            taxInclusiveAmount: totalAmount,
                            totalPayableAmount: totalAmount,
                            taxAmount: taxAmount
                        },

                        taxInformation: {
                            taxTypeCode: 'E',
                            taxRate: taxRate,
                            taxAmount: taxAmount,
                            taxExemptionReason: 'B2B Relief',
                            taxCategoryId: 'E',
                            taxSchemeId: 'OTH',
                            taxSchemeAgencyId: 'N/A'
                        },

                        lineItems: [{
                            lineId: 1,
                            quantity: 1,
                            unitPrice: totalAmount,
                            lineAmount: totalAmount,
                            description: 'TGC-U0040244-W1',
                            classificationCode: '022',
                            classificationType: 'CLASS',
                            taxTypeCode: 'E',
                            taxExemptionReason: 'B2B Relief',
                            taxScheme: 'OTH',
                            taxRate: `${taxRate}%`
                        }]
                    };
                }) : []
            };

            res.json({
                success: true,
                data: structuredPreview
            });
        } else {
            res.status(400).json({
                success: false,
                error: previewResult.error?.message || 'Preview failed'
            });
        }

    } catch (error) {
        console.error('Error previewing Excel file:', error);

        // Clean up temp file on error
        if (tempFilePath && fs.existsSync(tempFilePath)) {
            try {
                fs.unlinkSync(tempFilePath);
            } catch (cleanupError) {
                console.error('Error cleaning up temp file:', cleanupError);
            }
        }

        res.status(500).json({
            success: false,
            error: 'Error previewing Excel file: ' + error.message
        });
    }
});

// API endpoint to export consolidation data to Excel template
router.post('/export-template', [auth.isApiAuthenticated], async (req, res) => {
    try {
        const {
            invoice_details,
            tax_info,
            currency_info,
            totals,
            line_items,
            supplier_info
        } = req.body;

        // Create a new workbook
        const wb = XLSX.utils.book_new();

        // Prepare the data for Excel - one row per line item
        const excelData = line_items.map(item => ({
            SupplierName: supplier_info?.company_name || '',
            SupplierTIN: supplier_info?.tin_number || '',
            SupplierBRN: supplier_info?.business_registration_number || '',
            SupplierSST: supplier_info?.sst_number || 'NA',
            SupplierAddress: supplier_info?.address || '',
            SupplierAddress1: supplier_info?.address_line_1 || '',
            SupplierAddress2: supplier_info?.address_line_2 || '',
            SupplierCity: supplier_info?.city || '',
            SupplierState: supplier_info?.state || '',
            SupplierPostalZone: supplier_info?.postal_code || '',
            SupplierCountry: supplier_info?.country || 'MYS',
            SupplierContact: supplier_info?.contact_number || '',
            SupplierEmail: supplier_info?.email || '',
            BuyerName: 'General Public',
            BuyerTIN: 'EI00000000010',
            BuyerBRN: 'NA',
            BuyerSST: 'NA',
            BuyerAddress: 'NA',
            BuyerAddress1: '',
            BuyerAddress2: '',
            BuyerCity: 'NA',
            BuyerState: 'NA',
            BuyerPostalZone: '',
            BuyerCountry: 'NA',
            BuyerContact: 'NA',
            BuyerEmail: '',
            InvoiceNo: invoice_details.invoice_no,
            InvoiceDate: invoice_details.end_date,
            InvoiceTime: '23:59:00Z',
            CurrencyCode: currency_info.currency,
            TaxCurrencyCode: 'MYR',
            ExchangeRate: currency_info.exchange_rate,
            BillingPeriodStart: invoice_details.start_date,
            BillingPeriodEnd: invoice_details.end_date,
            BillingFrequency: 'Monthly',
            eInvoiceVersion: '1.0',
            eInvoiceType: '01',
            PaymentDueDate: '',
            PaymentTerms: '30 days',
            PaymentMeans: 'Transfer',
            PaymentMeansCode: '30',
            PaymentID: '',
            AccountID: '',
            PrepaidAmount: '0.00',
            ItemDescription: item.description,
            Classification: item.classification,
            TaxType: item.taxType,
            TaxRate: tax_info.tax_rate,
            TaxAmount: item.taxAmount,
            TaxExemptionReason: item.taxType === '06' ? 'Out of scope of SST' :
                               item.taxType === 'E' ? 'SST Exempted' : '',
            TaxExemptionCode: '',
            DiscountAmount: '0.00',
            DiscountReason: '',
            TotalExclTax: item.amount,
            TotalInclTax: item.totalAmount,
            Note: 'Generated from manual consolidation'
        }));

        // Create worksheet
        const ws = XLSX.utils.json_to_sheet(excelData);

        // Add the worksheet to the workbook
        XLSX.utils.book_append_sheet(wb, ws, 'Consolidated Invoice');

        // Generate buffer
        const excelBuffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

        // Set headers for file download
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="consolidated_invoice_${invoice_details.invoice_no}.xlsx"`);
        res.setHeader('Content-Length', excelBuffer.length);

        // Send the file
        res.send(excelBuffer);

    } catch (error) {
        console.error('Error generating Excel template:', error);
        res.status(500).json({
            success: false,
            message: 'Error generating Excel template',
            error: error.message
        });
    }
});

// Helper function to store parsed data in database
async function storeDataInDatabase(records, userId) {
    try {
        const processedRecords = [];
        const validationErrors = [];

        // Mandatory field groups according to MyInvois
        const mandatoryFields = {
            supplier: ['SupplierName', 'SupplierTIN', 'SupplierBRN', 'SupplierAddress', 'SupplierCity', 'SupplierState', 'SupplierCountry', 'SupplierContact'],
            buyer: ['BuyerName', 'BuyerTIN', 'BuyerBRN', 'BuyerAddress', 'BuyerCity', 'BuyerState', 'BuyerCountry', 'BuyerContact'],
            invoice: ['InvoiceNo', 'InvoiceDate', 'InvoiceTime', 'CurrencyCode', 'eInvoiceVersion', 'eInvoiceType'],
            items: ['ItemDescription', 'Classification', 'TaxType', 'TaxRate', 'TaxAmount', 'TotalExclTax', 'TotalInclTax']
        };

        for (let i = 0; i < records.length; i++) {
            const record = records[i];
            const errors = [];

            // Validate supplier fields
            for (const field of mandatoryFields.supplier) {
                if (!record[field] && field !== 'SupplierSST') {
                    errors.push(`Missing ${field} in record ${i + 1}`);
                }
            }

            // Validate buyer fields
            for (const field of mandatoryFields.buyer) {
                if (!record[field] && field !== 'BuyerSST') {
                    // For consolidated invoices, BuyerContact can be "NA"
                    if (field === 'BuyerContact' && record[field] === 'NA') {
                        continue;
                    }

                    // Special handling for consolidated invoices to General Public
                    if (record.BuyerName === 'General Public' &&
                        (field === 'BuyerBRN' || field === 'BuyerAddress' ||
                         field === 'BuyerCity' || field === 'BuyerState' ||
                         field === 'BuyerCountry' || field === 'BuyerContact')) {
                        if (record[field] === 'NA') {
                            continue;
                        }
                    }

                    errors.push(`Missing ${field} in record ${i + 1}`);
                }
            }

            // Validate invoice fields
            for (const field of mandatoryFields.invoice) {
                if (!record[field]) {
                    errors.push(`Missing ${field} in record ${i + 1}`);
                }
            }

            // Validate item fields
            for (const field of mandatoryFields.items) {
                if (!record[field]) {
                    errors.push(`Missing ${field} in record ${i + 1}`);
                }
            }

            // Handle currency exchange rate validation
            if (record.CurrencyCode && record.CurrencyCode !== 'MYR' && !record.ExchangeRate) {
                errors.push(`Exchange rate is required for currency ${record.CurrencyCode} in record ${i + 1}`);
            }

            if (errors.length > 0) {
                validationErrors.push({
                    recordIndex: i + 1,
                    errors: errors
                });
                continue;
            }

            // Set default values for optional fields or missing fields
            record.SupplierSST = record.SupplierSST || 'NA';
            record.BuyerSST = record.BuyerSST || 'NA';
            record.eInvoiceVersion = record.eInvoiceVersion || '1.0';
            record.ExchangeRate = record.ExchangeRate || (record.CurrencyCode === 'MYR' ? '1.0' : null);
            record.InvoiceTime = record.InvoiceTime || '00:00:00Z';
            record.eInvoiceType = record.eInvoiceType || '01';

            // Special handling for consolidated invoices
            if (record.BuyerName === 'General Public') {
                // Ensure all required fields for consolidated invoices are properly set
                record.BuyerTIN = 'EI00000000010';
                record.BuyerBRN = 'NA';
                record.BuyerSST = 'NA';
                record.BuyerAddress = 'NA';
                record.BuyerCity = 'NA';
                record.BuyerState = 'NA';
                record.BuyerCountry = 'NA';
                record.BuyerContact = 'NA';
            }

            // Extract billing period information if available
            const billingPeriodStart = record.BillingPeriodStart || null;
            const billingPeriodEnd = record.BillingPeriodEnd || null;

            // Generate UUID for the record
            const uuid = uuidv4();

            try {
                // Insert record into database using Sequelize model
                const newRecord = await database.WP_FLATFILE.create({
                    supplier_name: record.SupplierName,
                    supplier_tin: record.SupplierTIN,
                    supplier_brn: record.SupplierBRN,
                    supplier_sst: record.SupplierSST,
                    supplier_msic: record.SupplierMSIC,
                    supplier_address: record.SupplierAddress,
                    supplier_city: record.SupplierCity,
                    supplier_state: record.SupplierState,
                    supplier_country: record.SupplierCountry,
                    supplier_contact: record.SupplierContact,
                    buyer_name: record.BuyerName,
                    buyer_tin: record.BuyerTIN,
                    buyer_brn: record.BuyerBRN,
                    buyer_sst: record.BuyerSST,
                    buyer_address: record.BuyerAddress,
                    buyer_city: record.BuyerCity,
                    buyer_state: record.BuyerState,
                    buyer_country: record.BuyerCountry,
                    buyer_contact: record.BuyerContact,
                    invoice_no: record.InvoiceNo,
                    invoice_date: record.InvoiceDate,
                    invoice_time: record.InvoiceTime,
                    currency_code: record.CurrencyCode,
                    exchange_rate: record.ExchangeRate,
                    einvoice_version: record.eInvoiceVersion,
                    einvoice_type: record.eInvoiceType,
                    item_description: record.ItemDescription,
                    classification: record.Classification,
                    tax_type: record.TaxType,
                    tax_rate: record.TaxRate,
                    tax_amount: record.TaxAmount,
                    total_excl_tax: record.TotalExclTax,
                    total_incl_tax: record.TotalInclTax,
                    billing_period_start: billingPeriodStart,
                    billing_period_end: billingPeriodEnd,
                    notes: record.Note,
                    processed_by: userId,
                    status: 'Pending',
                    creation_type: 'Upload',
                    uuid: uuid,
                    upload_date: new Date()
                });

                processedRecords.push({
                    id: newRecord.id,
                    uuid: uuid,
                    invoiceNo: record.InvoiceNo
                });
            } catch (dbError) {
                validationErrors.push({
                    recordIndex: i + 1,
                    errors: [`Database error: ${dbError.message}`]
                });
            }
        }

        if (validationErrors.length > 0) {
            throw new Error(`Validation errors: ${JSON.stringify(validationErrors)}`);
        }

        return processedRecords;
    } catch (error) {
        throw error;
    }
}

// API endpoint for bulk submission of uploaded files
router.post('/bulk-submit-files', [auth.isApiAuthenticated], async (req, res) => {
    try {
        const { fileIds } = req.body;

        if (!fileIds || !Array.isArray(fileIds) || fileIds.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'File IDs array is required'
            });
        }

        // LHDN limitations check
        if (fileIds.length > 100) {
            return res.status(400).json({
                success: false,
                error: 'Maximum 100 files can be submitted at once (LHDN limitation)'
            });
        }

        // Get files from database
        const files = await prisma.wP_UPLOADED_EXCEL_FILES.findMany({
            where: {
                id: { in: fileIds.map(id => parseInt(id)) },
                uploaded_by_user_id: req.user.id,
                processing_status: 'processed'
            }
        });

        if (files.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'No valid processed files found for submission'
            });
        }

        // Calculate total size and document count
        let totalSize = 0;
        let totalDocuments = 0;

        for (const file of files) {
            totalSize += parseInt(file.file_size.toString());
            totalDocuments += file.invoice_count;
        }

        // Check LHDN size limitations (5MB = 5 * 1024 * 1024 bytes)
        const maxSize = 5 * 1024 * 1024;
        if (totalSize > maxSize) {
            return res.status(400).json({
                success: false,
                error: `Total file size (${(totalSize / 1024 / 1024).toFixed(2)}MB) exceeds LHDN limit of 5MB`
            });
        }

        // Check document count limitation
        if (totalDocuments > 100) {
            return res.status(400).json({
                success: false,
                error: `Total document count (${totalDocuments}) exceeds LHDN limit of 100 documents per submission`
            });
        }

        // Update files status to submitting
        await prisma.wP_UPLOADED_EXCEL_FILES.updateMany({
            where: { id: { in: fileIds.map(id => parseInt(id)) } },
            data: { processing_status: 'submitting' }
        });

        // Process bulk submission in background
        processBulkSubmission(files, req.user).catch(error => {
            console.error('Background bulk submission error:', error);
        });

        res.json({
            success: true,
            message: `Bulk submission initiated for ${files.length} files with ${totalDocuments} total documents`,
            data: {
                fileCount: files.length,
                totalDocuments: totalDocuments,
                totalSize: totalSize,
                files: files.map(f => ({
                    id: f.id,
                    filename: f.filename,
                    invoiceCount: f.invoice_count,
                    fileSize: f.file_size.toString()
                }))
            }
        });

    } catch (error) {
        console.error('Bulk submission error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to process bulk submission'
        });
    }
});

// API endpoint to delete uploaded file
router.delete('/uploaded-files/:fileId(\\d+)', [auth.isApiAuthenticated], async (req, res) => {
    try {
        // Defensive user context check
        if (!req.user?.id) {
            return res.status(401).json({ success: false, error: 'Unauthorized (no user context)' });
        }

        const { fileId } = req.params;
        const id = parseInt(fileId, 10);
        if (!Number.isFinite(id)) {
            return res.status(400).json({ success: false, error: 'Invalid file ID' });
        }

        // Get file details
        const file = await prisma.wP_UPLOADED_EXCEL_FILES.findFirst({
            where: {
                id,
                uploaded_by_user_id: req.user.id
            }
        });

        if (!file) {
            return res.status(404).json({
                success: false,
                error: 'File not found'
            });
        }

        // Delete physical file if it exists (guard path)
        if (file.file_path && typeof file.file_path === 'string' && fs.existsSync(file.file_path)) {
            fs.unlinkSync(file.file_path);
        }

        // Delete database record
        await prisma.wP_UPLOADED_EXCEL_FILES.delete({
            where: { id }
        });

        res.json({
            success: true,
            message: 'File deleted successfully'
        });

    } catch (error) {
        console.error('Error deleting file:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to delete file'
        });
    }
});

// API endpoint to bulk delete uploaded files
router.delete('/uploaded-files/bulk', [auth.isApiAuthenticated], async (req, res) => {
    try {
        // Defensive checks for user context
        if (!req.user?.id) {
            return res.status(401).json({ success: false, error: 'Unauthorized (no user context)' });
        }

        const { fileIds } = req.body;

        if (!fileIds || !Array.isArray(fileIds) || fileIds.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'File IDs array is required'
            });
        }

        // Sanitize and validate IDs
        const ids = fileIds.map(id => parseInt(id, 10)).filter(Number.isFinite);
        if (ids.length === 0) {
            return res.status(400).json({ success: false, error: 'No valid file IDs' });
        }

        // Get files to delete (ensure they belong to the current user)
        const files = await prisma.wP_UPLOADED_EXCEL_FILES.findMany({
            where: {
                id: { in: ids },
                uploaded_by_user_id: req.user.id
            }
        });

        if (files.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'No files found to delete'
            });
        }

        const deletedFiles = [];
        const failedFiles = [];

        // Delete physical files and database records
        for (const file of files) {
            try {
                // Delete physical file if it exists (guard path)
                if (file.file_path && typeof file.file_path === 'string' && fs.existsSync(file.file_path)) {
                    fs.unlinkSync(file.file_path);
                }

                // Delete database record
                await prisma.wP_UPLOADED_EXCEL_FILES.delete({
                    where: { id: file.id }
                });

                deletedFiles.push({
                    id: file.id,
                    filename: file.original_filename
                });
            } catch (error) {
                console.error(`Error deleting file ${file.id}:`, error);
                failedFiles.push({
                    id: file.id,
                    filename: file.original_filename,
                    error: error.message
                });
            }
        }

        res.json({
            success: true,
            message: `Successfully deleted ${deletedFiles.length} file(s)`,
            deletedFiles,
            failedFiles,
            summary: {
                requested: ids.length,
                found: files.length,
                deleted: deletedFiles.length,
                failed: failedFiles.length
            }
        });

    } catch (error) {
        console.error('Error in bulk delete:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to delete files'
        });
    }
});

// API endpoint to get file details
router.get('/uploaded-files/:fileId/details', [auth.isApiAuthenticated], async (req, res) => {
    try {
        const { fileId } = req.params;

        const file = await prisma.wP_UPLOADED_EXCEL_FILES.findFirst({
            where: {
                id: parseInt(fileId),
                uploaded_by_user_id: req.user.id
            }
        });

        if (!file) {
            return res.status(404).json({
                success: false,
                error: 'File not found'
            });
        }

        // Convert BigInt to string for JSON serialization
        const fileDetails = {
            ...file,
            file_size: file.file_size.toString(),
            processing_logs: file.processing_logs ? JSON.parse(file.processing_logs) : null,
            metadata: file.metadata ? JSON.parse(file.metadata) : null,
            lhdn_response: file.lhdn_response ? JSON.parse(file.lhdn_response) : null
        };

        res.json({
            success: true,
            data: fileDetails
        });

    } catch (error) {
        console.error('Error getting file details:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get file details'
        });
    }
});
// API endpoint to submit a single uploaded file synchronously (returns immediate result)
router.post('/uploaded-files/:fileId/submit-single', [auth.isApiAuthenticated], async (req, res) => {
    try {
        const { fileId } = req.params;
        const version = '1.0';

        const file = await prisma.wP_UPLOADED_EXCEL_FILES.findFirst({
            where: {
                id: parseInt(fileId),
                uploaded_by_user_id: req.user.id
            }
        });

        if (!file) {
            return res.status(404).json({ success: false, error: 'File not found' });
        }

        if ((file.processing_status || '').toLowerCase() !== 'processed') {
            return res.status(400).json({ success: false, error: 'This file is not ready for submission. Please process the file first.' });
        }

        const invoiceCount = parseInt(file.invoice_count || 0, 10) || 0;
        if (invoiceCount > 100) {
            return res.status(400).json({ success: false, error: `This file contains ${invoiceCount} documents which exceeds LHDN limit of 100 per submission.` });
        }

        if (!fs.existsSync(file.file_path)) {
            return res.status(404).json({ success: false, error: 'Physical file not found' });
        }

        // Prefer pre-generated documents from metadata (prepared step)
        let meta = {};
        try { meta = file.metadata ? JSON.parse(file.metadata) : {}; } catch(_) { meta = {}; }
        let preparedDocs = meta?.preparedDocuments;
        let invoiceNumbers = (meta?.prepared && Array.isArray(meta.prepared.invoiceNumbers)) ? meta.prepared.invoiceNumbers : [];

        let documents = [];
        let preparedInvoices = [];

        if (Array.isArray(preparedDocs) && preparedDocs.length > 0) {
            console.log('submit-single: using pre-generated documents from metadata', preparedDocs.length);
            documents = preparedDocs;
            preparedInvoices = invoiceNumbers || [];
        } else {
            // Fallback: Process Excel and map to LHDN JSON per invoice (legacy path)
            console.log('submit-single: prepared docs not found, generating on-the-fly');
            const processingResult = await consumeExcelFile(file.file_path);
            if (!processingResult.success || !processingResult.processingResults) {
                return res.status(400).json({ success: false, error: 'Failed to process Excel file' });
            }

            const processedData = processingResult.processingResults;

            // Duplicate prevention: block resubmission if already submitted
            if (file.submitted_date || (file.processing_status && ['submitted','cancelled'].includes(String(file.processing_status).toLowerCase()))) {
                return res.status(409).json({
                    success: false,
                    error: 'This file appears to have been submitted already.',
                    details: {
                        submittedDate: file.submitted_date,
                        submissionUid: file.submission_uid || null,
                        status: file.processing_status
                    }
                });
            }

            if (!Array.isArray(processedData) || processedData.length === 0) {
                return res.status(400).json({ success: false, error: 'No valid documents found in Excel file' });
            }

            const submitter = new LHDNSubmitter(req);
            for (const invoiceData of processedData) {
                const lhdnJson = mapToLHDNFormat([invoiceData], version);
                if (!lhdnJson) {
                    return res.status(400).json({ success: false, error: 'Failed to map invoice data to LHDN format' });
                }
                const { payload, invoice_number } = await submitter.prepareDocumentForSubmission(lhdnJson, version);
                if (!payload || !payload.documents || !payload.documents[0]) {
                    return res.status(400).json({ success: false, error: 'Failed to prepare document for submission' });
                }
                documents.push(payload.documents[0]);
                preparedInvoices.push(invoice_number);
            }
        }

        const submitter = new LHDNSubmitter(req);
        const result = await submitter.submitToLHDNDocument(documents);

        // Update DB quickly with result snapshot
        // Do not flip status to "error" for pre-submission validation failures.
        // Keep it as "processed" (which renders as "Ready to Submit") so users can fix and retry.
        const _nonSuccessCode = result && result.error && result.error.code;
        const _desiredStatus = result.status === 'success'
            ? 'submitted'
            : (_nonSuccessCode === 'PRE_SUBMISSION_VALIDATION_FAILED' ? 'processed' : 'error');

        await prisma.wP_UPLOADED_EXCEL_FILES.update({
            where: { id: file.id },
            data: {
                processing_status: _desiredStatus,
                submitted_date: result.status === 'success' ? new Date() : file.submitted_date,
                lhdn_response: JSON.stringify(result),
                updated_at: new Date()
            }
        });

        if (result.status === 'success') {
            return res.json({ success: true, lhdnResponse: result });
        }
        return res.status(400).json({ success: false, error: result.error?.message || 'LHDN submission failed', details: result.error?.details || [] });
    } catch (err) {
        console.error('Single submission error:', err);
        return res.status(500).json({ success: false, error: err.message || 'Failed to submit file to LHDN' });
    }
});

// NEW: Prepare documents endpoint (pre-generate JSON and store in metadata)
router.post('/uploaded-files/:fileId/prepare', [auth.isApiAuthenticated], async (req, res) => {
    try {
        const { fileId } = req.params;
        const version = '1.0';

        const file = await prisma.wP_UPLOADED_EXCEL_FILES.findFirst({
            where: { id: parseInt(fileId), uploaded_by_user_id: req.user.id }
        });
        if (!file) return res.status(404).json({ success:false, error:'File not found' });
        if (!fs.existsSync(file.file_path)) return res.status(404).json({ success:false, error:'Physical file not found' });

        const processingResult = await consumeExcelFile(file.file_path);
        if (!processingResult.success || !processingResult.processingResults) {
            return res.status(400).json({ success:false, error:'Failed to process Excel file' });
        }
        const processedData = processingResult.processingResults;
        const submitter = new LHDNSubmitter(req);
        const documents = [];
        const invoiceNumbers = [];
        for (const invoiceData of processedData) {
            const lhdnJson = mapToLHDNFormat([invoiceData], version);
            if (!lhdnJson) return res.status(400).json({ success:false, error:'Failed to map invoice data to LHDN format' });
            const { payload, invoice_number } = await submitter.prepareDocumentForSubmission(lhdnJson, version);
            if (!payload || !payload.documents || !payload.documents[0]) return res.status(400).json({ success:false, error:'Failed to prepare document for submission' });
            documents.push(payload.documents[0]);
            invoiceNumbers.push(invoice_number);
        }

        // Persist prepared docs to metadata for fast submit step
        let meta = {}; try{ meta = file.metadata ? JSON.parse(file.metadata) : {}; }catch(_){ meta = {}; }
        meta.preparedDocuments = documents;
        meta.prepared = { at: new Date().toISOString(), invoiceNumbers };
        await prisma.wP_UPLOADED_EXCEL_FILES.update({
            where: { id: file.id },
            data: { metadata: JSON.stringify(meta), updated_at: new Date() }
        });

        return res.json({ success:true, data:{ preparedCount: documents.length } });
    } catch (err) {
        console.error('Prepare documents error:', err);
        return res.status(500).json({ success:false, error: err.message || 'Prepare failed' });
    }
});

// NEW: Check duplicates endpoint (LHDN best practices compliant)
router.post('/uploaded-files/:fileId/check-duplicates', [auth.isApiAuthenticated], async (req, res) => {
    try {
        console.log('check-duplicates: starting for fileId', req.params.fileId);
        const { fileId } = req.params;

        const file = await prisma.wP_UPLOADED_EXCEL_FILES.findFirst({
            where: { id: parseInt(fileId), uploaded_by_user_id: req.user.id }
        });
        if (!file) {
            console.log('check-duplicates: file not found', fileId);
            return res.status(404).json({ success:false, error:'File not found' });
        }

        console.log('check-duplicates: file found, checking metadata for prepared invoices');
        let meta = {};
        try { meta = file.metadata ? JSON.parse(file.metadata) : {}; } catch(_) { meta = {}; }

        const invoiceNumbers = (meta?.prepared && Array.isArray(meta.prepared.invoiceNumbers))
            ? meta.prepared.invoiceNumbers
            : [];

        console.log('check-duplicates: found invoice numbers', invoiceNumbers.length);

        // LHDN Best Practice: Check for duplicates in multiple sources
        const duplicates = [];
        const warnings = [];

        if (invoiceNumbers.length > 0) {
            // 1. Check against WP_OUTBOUND_STATUS (our local submissions)
            const existingSubmissions = await prisma.wP_OUTBOUND_STATUS.findMany({
                where: {
                    invoice_number: { in: invoiceNumbers },
                    status: { not: 'Cancelled' }
                },
                select: { invoice_number: true, status: true, date_submitted: true, UUID: true }
            });

            console.log('check-duplicates: found existing submissions in WP_OUTBOUND_STATUS', existingSubmissions.length);

            // 2. Check against recent submissions in same table (within 10 minutes - LHDN duplicate detection window)
            const recentCutoff = new Date(Date.now() - 10 * 60 * 1000); // 10 minutes ago
            const recentSubmissions = await prisma.wP_UPLOADED_EXCEL_FILES.findMany({
                where: {
                    uploaded_by_user_id: req.user.id,
                    submitted_date: { gte: recentCutoff },
                    processing_status: 'submitted',
                    id: { not: parseInt(fileId) } // exclude current file
                },
                select: { id: true, filename: true, submitted_date: true, metadata: true }
            });

            console.log('check-duplicates: found recent submissions', recentSubmissions.length);

            // Check for invoice number overlaps in recent submissions
            for (const recent of recentSubmissions) {
                try {
                    const recentMeta = recent.metadata ? JSON.parse(recent.metadata) : {};
                    const recentInvoices = recentMeta?.prepared?.invoiceNumbers || [];
                    const overlap = invoiceNumbers.filter(inv => recentInvoices.includes(inv));
                    if (overlap.length > 0) {
                        warnings.push({
                            type: 'recent_submission',
                            message: `Similar invoices submitted recently in file: ${recent.filename}`,
                            invoiceNumbers: overlap,
                            submittedAt: recent.submitted_date
                        });
                    }
                } catch(_) { /* ignore metadata parse errors */ }
            }

            // Add confirmed duplicates
            duplicates.push(...existingSubmissions.map(sub => ({
                invoiceNumber: sub.invoice_number,
                status: sub.status,
                dateSubmitted: sub.date_submitted,
                uuid: sub.UUID,
                source: 'WP_OUTBOUND_STATUS',
                severity: 'error'
            })));
        }

        // LHDN Compliance: Check file size and document count limits
        const fileStats = {
            invoiceCount: invoiceNumbers.length,
            fileSizeKB: Math.round(parseInt(file.file_size) / 1024),
            withinLimits: {
                documentCount: invoiceNumbers.length <= 100, // LHDN limit: 100 docs per submission
                fileSize: parseInt(file.file_size) <= 5 * 1024 * 1024 // LHDN limit: 5MB per submission
            }
        };

        if (!fileStats.withinLimits.documentCount) {
            duplicates.push({
                type: 'limit_exceeded',
                severity: 'error',
                message: `Document count (${fileStats.invoiceCount}) exceeds LHDN limit of 100 per submission`,
                source: 'LHDN_VALIDATION'
            });
        }

        if (!fileStats.withinLimits.fileSize) {
            duplicates.push({
                type: 'limit_exceeded',
                severity: 'error',
                message: `File size (${fileStats.fileSizeKB}KB) exceeds LHDN limit of 5MB per submission`,
                source: 'LHDN_VALIDATION'
            });
        }

        console.log('check-duplicates: returning', duplicates.length, 'duplicates and', warnings.length, 'warnings');
        return res.json({
            success: true,
            data: {
                duplicates,
                warnings,
                invoiceCount: invoiceNumbers.length,
                fileStats,
                lhdnCompliant: duplicates.filter(d => d.severity === 'error').length === 0
            }
        });
    } catch (err) {
        console.error('Check duplicates error:', err);
        return res.status(500).json({ success:false, error: err.message || 'Duplicate check failed' });
    }
});

// NEW: LHDN Get Submission API integration
router.get('/submission-status/:submissionUid', [auth.isApiAuthenticated], async (req, res) => {
    try {
        console.log('get-submission-status: starting for submissionUid', req.params.submissionUid);
        const { submissionUid } = req.params;

        // Initialize LHDN submitter to call Get Submission API
        const submitter = new LHDNSubmitter(req);

        // Call LHDN Get Submission API using existing method
        const submissionData = await submitter.getSubmissionDetails(submissionUid);

        console.log('get-submission-status: LHDN response', submissionData?.success, 'status:', submissionData?.status);

        return res.json({
            success: true,
            data: submissionData
        });
    } catch (err) {
        console.error('Get submission status error:', err);
        return res.status(500).json({
            success: false,
            error: err.message || 'Failed to get submission status'
        });
    }
});


// API endpoint to reprocess file
router.post('/uploaded-files/:fileId/reprocess', [auth.isApiAuthenticated], async (req, res) => {
    try {
        const { fileId } = req.params;

        const file = await prisma.wP_UPLOADED_EXCEL_FILES.findFirst({
            where: {
                id: parseInt(fileId),
                uploaded_by_user_id: req.user.id
            }
        });

        if (!file) {
            return res.status(404).json({
                success: false,
                error: 'File not found'
            });
        }

        if (!fs.existsSync(file.file_path)) {
            return res.status(404).json({
                success: false,
                error: 'Physical file not found'
            });
        }

        // Update status to processing
        await prisma.wP_UPLOADED_EXCEL_FILES.update({
            where: { id: parseInt(fileId) },
            data: {
                processing_status: 'processing',
                error_message: null,
                processed_date: null
            }
        });

        // Reprocess the file
        const processingResult = await consumeExcelFile(file.file_path);

        if (!processingResult.success) {
            await prisma.wP_UPLOADED_EXCEL_FILES.update({
                where: { id: parseInt(fileId) },
                data: {
                    processing_status: 'error',
                    error_message: processingResult.error || 'Failed to reprocess file',
                    processed_date: new Date()
                }
            });

            return res.status(400).json({
                success: false,
                error: processingResult.error || 'Failed to reprocess file'
            });
        }

        const processedData = processingResult.processingResults;

        // Update database with new processing results
        await prisma.wP_UPLOADED_EXCEL_FILES.update({
            where: { id: parseInt(fileId) },
            data: {
                invoice_count: processedData.length,
                processing_status: 'processed',
                processed_date: new Date(),
                processing_logs: JSON.stringify(processingResult.logs),
                error_message: null
            }
        });

        res.json({
            success: true,
            message: `File reprocessed successfully. ${processedData.length} invoices found.`,
            data: {
                invoiceCount: processedData.length,
                processingLogs: processingResult.logs
            }
        });

    } catch (error) {
        console.error('Error reprocessing file:', error);

        // Update status to error
        await prisma.wP_UPLOADED_EXCEL_FILES.update({
            where: { id: parseInt(req.params.fileId) },
            data: {
                processing_status: 'error',
                error_message: error.message,
                processed_date: new Date()
            }
        });

        res.status(500).json({
            success: false,
            error: 'Failed to reprocess file'
        });
    }
});

// Background function to process bulk submission
async function processBulkSubmission(files, user) {
    console.log(`Starting bulk submission for ${files.length} files`);

    try {
        // Token management is handled inside LHDNSubmitter (session-aware with fallback cache)
        let successCount = 0;
        let errorCount = 0;
        const results = [];

        for (const file of files) {
            try {
                console.log(`Processing file: ${file.filename}`);

                // Read and process the Excel file
                const filePath = file.file_path;
                if (!fs.existsSync(filePath)) {
                    throw new Error(`File not found: ${filePath}`);
                }

                // Process Excel file to get invoice data
                const processingResult = await consumeExcelFile(filePath);
                if (!processingResult.success || !processingResult.processingResults) {
                    throw new Error('Failed to process Excel file');
                }

                const processedData = processingResult.processingResults;
                console.log(`Found ${processedData.length} invoices in ${file.filename}`);

                // Submit each invoice to LHDN
                for (const invoiceData of processedData) {
                    try {
                        // Map to LHDN format
                        const lhdnJson = mapToLHDNFormat([invoiceData], '1.0');
                        if (!lhdnJson) {
                            throw new Error('Failed to map invoice data to LHDN format');
                        }

                        // Prepare document for submission
                        const submitter = new LHDNSubmitter({ user });
                        const { payload, invoice_number } = await submitter.prepareDocumentForSubmission(lhdnJson, '1.0');

                        if (!payload) {
                            throw new Error('Failed to prepare document for submission');
                        }

                        // Submit to LHDN (use prepared documents array)
                        const result = await submitter.submitToLHDNDocument(payload.documents);

                        if (result.status === 'success' && result.data?.acceptedDocuments?.length > 0) {
                            const acceptedDoc = result.data.acceptedDocuments[0];
                            console.log(`Successfully submitted invoice ${invoice_number}, UUID: ${acceptedDoc.uuid}`);
                            successCount++;
                        } else {
                            console.error(`Failed to submit invoice ${invoice_number}:`, result.error);
                            errorCount++;
                        }

                    } catch (invoiceError) {
                        console.error(`Error submitting invoice from ${file.filename}:`, invoiceError);
                        errorCount++;
                    }
                }

                // Update file status to submitted
                await prisma.wP_UPLOADED_EXCEL_FILES.update({
                    where: { id: file.id },
                    data: {
                        processing_status: 'submitted',
                        submitted_date: new Date(),
                        lhdn_response: JSON.stringify({
                            success: true,
                            submittedAt: new Date(),
                            invoicesProcessed: processedData.length
                        })
                    }
                });

                results.push({
                    fileId: file.id,
                    filename: file.filename,
                    status: 'success',
                    invoicesProcessed: processedData.length
                });

            } catch (fileError) {
                console.error(`Error processing file ${file.filename}:`, fileError);

                // Update file status to error
                await prisma.wP_UPLOADED_EXCEL_FILES.update({
                    where: { id: file.id },
                    data: {
                        // If the error is a pre-submission validation error, keep status as processed
                        processing_status: (fileError && fileError.code === 'PRE_SUBMISSION_VALIDATION_FAILED') ? 'processed' : 'error',
                        error_message: fileError.message,
                        lhdn_response: JSON.stringify({
                            success: false,
                            error: fileError.message,
                            timestamp: new Date()
                        })
                    }
                });

                results.push({
                    fileId: file.id,
                    filename: file.filename,
                    status: 'error',
                    error: fileError.message
                });

                errorCount++;
            }
        }

        console.log(`Bulk submission completed. Success: ${successCount}, Errors: ${errorCount}`);

    } catch (error) {
        console.error('Bulk submission process error:', error);

        // Update all files to error status
        const fileIds = files.map(f => f.id);
        await prisma.wP_UPLOADED_EXCEL_FILES.updateMany({
            where: { id: { in: fileIds } },
            data: {
                processing_status: 'error',
                error_message: `Bulk submission failed: ${error.message}`
            }
        });
    }
}

module.exports = router;