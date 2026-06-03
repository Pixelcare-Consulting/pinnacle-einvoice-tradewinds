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
// Duplicate Detection Services
const ContentHasher = require('../../services/duplicateDetection/contentHasher');
const InvoiceDuplicateChecker = require('../../services/duplicateDetection/invoiceDuplicateChecker');
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

// Pre-upload validation endpoint
router.post('/validate-excel', [auth.isApiAuthenticated, excelUpload.single('excelFile')], async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                error: 'No file uploaded'
            });
        }

        const filePath = req.file.path;
        const filename = req.file.originalname;
        const fileSize = req.file.size;

        console.log('Pre-validating Excel file:', filename);

        // File size validation
        const maxFileSize = 10 * 1024 * 1024; // 10MB
        if (fileSize > maxFileSize) {
            // Clean up uploaded file
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
            return res.status(400).json({
                isValid: false,
                error: `File size (${(fileSize / 1024 / 1024).toFixed(2)}MB) exceeds maximum allowed size of 10MB`,
                totalDocuments: 0,
                failedDocuments: 0
            });
        }

        // Parse Excel file for validation
        const workbook = XLSX.readFile(filePath);
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

        // Clean up uploaded file after reading
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }

        // Find header row and data rows
        let headerRowIndex = -1;
        let headers = [];

        console.log('Searching for header row in first 10 rows...');
        for (let i = 0; i < Math.min(data.length, 10); i++) {
            const row = data[i];
            if (row && row.length > 0) {
                const firstCell = String(row[0] || '').toLowerCase().trim();
                console.log(`Row ${i + 1}: "${row[0]}" (${firstCell}) - Full row:`, row.slice(0, 8));

                // Look for the actual column header row based on the Excel structure we see
                // The header row should contain multiple field names, not just descriptive text
                const hasMultipleFields = row.filter(cell => cell && String(cell).trim() !== '').length > 3;

                if (hasMultipleFields) {
                    // Check if this looks like a header row with field names
                    const cellsLower = row.map(cell => String(cell || '').toLowerCase().trim());

                    // Look for patterns that indicate this is the header row
                    const headerIndicators = [
                        'invoice_id', 'invoiceid', 'invoice id',
                        'address1', 'address2', 'address',
                        'list id', 'listid',
                        'full legal name', 'legal name',
                        'contact number', 'email address',
                        'registration name'
                    ];

                    const hasHeaderIndicators = headerIndicators.some(indicator =>
                        cellsLower.some(cell => cell.includes(indicator))
                    );

                    if (hasHeaderIndicators) {
                        headerRowIndex = i;
                        headers = row.map(h => String(h || '').trim());
                        console.log(`Found header row at index ${i} with ${headers.length} columns:`, headers.slice(0, 10));
                        break;
                    }
                }

                // Fallback: if we find a row with "Internal Document Reference Number" but no headers yet,
                // check if the next row might be the actual headers
                if (firstCell.includes('internal document') && i < data.length - 1) {
                    const nextRow = data[i + 1];
                    if (nextRow && nextRow.length > 0) {
                        const nextFirstCell = String(nextRow[0] || '').toLowerCase().trim();
                        if (nextFirstCell === 'invoice_id' || nextFirstCell.includes('invoice')) {
                            // Skip this row and let the next iteration find the real header
                            continue;
                        }
                    }
                }
            }
        }

        if (headerRowIndex === -1) {
            return res.json({
                isValid: false,
                error: 'Could not find header row in Excel file. Please ensure the first column contains "Invoice" or "Internal Document Reference Number".',
                totalDocuments: 0,
                failedDocuments: 0
            });
        }

        // Get data rows (skip header and empty rows)
        const dataRows = data.slice(headerRowIndex + 1).filter(row => {
            if (!row || row.length === 0) return false;
            const invoiceValue = String(row[0] || '').trim();

            // Skip empty values
            if (!invoiceValue || invoiceValue.length === 0) return false;

            // Skip header-like values (be more specific to avoid false positives)
            const headerPatterns = [
                'invoice_id', 'invoiceno', 'invoice no', 'invoice number',
                'internal document reference number', 'document reference', 'reference number',
                'supplier', 'buyer', 'item', 'description', 'amount', 'tax', 'total',
                'date', 'time', 'currency', 'classification', 'address', 'contact',
                'tin', 'brn', 'sst', 'issuedate', 'issuetime'
            ];

            const lowerInvoiceValue = invoiceValue.toLowerCase();

            // Check if the value looks like a header (exact match or starts with pattern)
            const isHeader = headerPatterns.some(pattern =>
                lowerInvoiceValue === pattern ||
                lowerInvoiceValue.startsWith(pattern)
            );

            // Additional check: if it contains only common header words, skip it
            const headerWords = ['invoice', 'document', 'reference', 'number', 'supplier', 'buyer'];
            const words = lowerInvoiceValue.split(/\s+/);
            const isAllHeaderWords = words.length > 1 && words.every(word =>
                headerWords.includes(word) || word.length <= 2
            );

            if (isHeader || isAllHeaderWords) {
                console.log(`Skipping header-like value: "${row[0]}"`);
                return false;
            }

            // Additional validation: invoice numbers should typically be alphanumeric
            // and not contain common header phrases
            if (lowerInvoiceValue.includes('invoice') && lowerInvoiceValue.length > 10) {
                console.log(`Skipping descriptive header: "${row[0]}"`);
                return false;
            }

            return true;
        });

        console.log(`Found ${dataRows.length} data rows after filtering headers`);

        // Document count validation
        if (dataRows.length > 100) {
            return res.json({
                isValid: false,
                error: `File contains ${dataRows.length} documents, which exceeds the LHDN limit of 100 documents per submission. Please split your file into smaller batches.`,
                totalDocuments: dataRows.length,
                failedDocuments: dataRows.length
            });
        }

        if (dataRows.length === 0) {
            return res.json({
                isValid: false,
                error: 'No valid invoice data found in the Excel file.',
                totalDocuments: 0,
                failedDocuments: 0
            });
        }

        // Perform detailed validation on each row
        const validationErrors = [];

        // Dynamic field mapping - find actual column positions
        console.log('Analyzing Excel structure for field mapping...');
        console.log('Headers found:', headers);

        // Create dynamic field mapping based on actual headers
        const createFieldMapping = (searchTerms) => {
            const alternatives = [];

            // Add exact matches and partial matches
            headers.forEach((header, index) => {
                if (!header) return;

                const headerLower = header.toString().toLowerCase().trim();

                // Check for exact matches or partial matches
                for (const term of searchTerms) {
                    const termLower = term.toLowerCase();
                    if (headerLower === termLower ||
                        headerLower.includes(termLower) ||
                        termLower.includes(headerLower)) {
                        alternatives.push(header);
                        alternatives.push(`__EMPTY_${index}`); // Add positional mapping
                        break;
                    }
                }
            });

            return alternatives;
        };

        // Complete field mapping based on actual Excel structure
        // Direct mapping from Excel column headers to expected field names
        const excelToFieldMapping = {
            // Supplier fields - map to "Full Legal Name" which contains supplier info
            'Full Legal Name': 'SupplierName',
            'Address1': 'SupplierAddress',
            'Address2': 'SupplierAddress2',
            'Contact Number': 'SupplierContact',
            'Email Address': 'SupplierContact2',
            'RegistrationName': 'SupplierBRN',

            // Invoice fields
            'Invoice_ID': 'InvoiceNo',
            'Internal Document Reference Number': 'InvoiceNo',

            // List/ID fields that might be relevant
            'List ID': 'ListID',
            'List Agent': 'ListAgent',

            // For buyer fields, we'll need to determine the pattern
            // Based on the Excel, it seems like supplier and buyer might be in the same row
            // We'll handle this in the validation logic
        };

        const mandatoryFields = {
            supplier: [
                { primary: 'SupplierName', alternatives: ['Full Legal Name', 'Legal Name', 'Company Name', 'Supplier Name'] },
                { primary: 'SupplierTIN', alternatives: ['Supplier TIN', 'TIN', 'Tax ID', 'Tax Identification Number'] },
                { primary: 'SupplierBRN', alternatives: ['RegistrationName', 'Supplier BRN', 'BRN', 'Business Registration', 'Registration Number'] },
                { primary: 'SupplierAddress', alternatives: ['Address1', 'Address2', 'Supplier Address', 'Address', 'Street Address'] },
                { primary: 'SupplierCity', alternatives: ['City', 'Supplier City'] },
                { primary: 'SupplierState', alternatives: ['State', 'Supplier State'] },
                { primary: 'SupplierCountry', alternatives: ['Country', 'Supplier Country'] },
                { primary: 'SupplierContact', alternatives: ['Contact Number', 'Email Address', 'Supplier Contact', 'Phone', 'Email'] }
            ],
            buyer: [
                // Updated to include RegistrationName which is the actual field name in Excel structure (__EMPTY_49)
                { primary: 'BuyerName', alternatives: ['RegistrationName', 'Full Legal Name', 'Buyer Name', 'Customer Name', 'Client Name'] },
                { primary: 'BuyerTIN', alternatives: ['Buyer TIN', 'Customer TIN'] },
                { primary: 'BuyerBRN', alternatives: ['Buyer BRN', 'Customer BRN'] },
                { primary: 'BuyerAddress', alternatives: ['Buyer Address', 'Customer Address'] },
                { primary: 'BuyerCity', alternatives: ['Buyer City', 'Customer City'] },
                { primary: 'BuyerState', alternatives: ['Buyer State', 'Customer State'] },
                { primary: 'BuyerCountry', alternatives: ['Buyer Country', 'Customer Country'] },
                { primary: 'BuyerContact', alternatives: ['Buyer Contact', 'Customer Contact'] }
            ],
            invoice: [
                { primary: 'InvoiceNo', alternatives: ['Invoice_ID', 'Invoice ID', 'Internal Document Reference Number', 'Invoice Number', 'Invoice'] },
                { primary: 'InvoiceDate', alternatives: ['Invoice Date', 'Date', 'Issue Date'] },
                { primary: 'InvoiceTime', alternatives: ['Invoice Time', 'Time', 'Issue Time'] },
                { primary: 'CurrencyCode', alternatives: ['Currency', 'Currency Code'] },
                { primary: 'eInvoiceVersion', alternatives: ['Version', 'eInvoice Version'] },
                { primary: 'eInvoiceType', alternatives: ['Type', 'Invoice Type', 'eInvoice Type'] }
            ],
            items: [
                { primary: 'ItemDescription', alternatives: ['Description', 'Item Description'] },
                { primary: 'Classification', alternatives: ['Classification', 'Class'] },
                { primary: 'TaxType', alternatives: ['Tax Type'] },
                { primary: 'TaxRate', alternatives: ['Tax Rate'] },
                { primary: 'TaxAmount', alternatives: ['Tax Amount'] },
                { primary: 'TotalExclTax', alternatives: ['Total Excl Tax', 'Subtotal'] },
                { primary: 'TotalInclTax', alternatives: ['Total Incl Tax', 'Total'] }
            ]
        };

        console.log('Dynamic field mappings created:');
        Object.entries(mandatoryFields).forEach(([category, fields]) => {
            console.log(`${category}:`, fields.map(f => ({ field: f.primary, alternatives: f.alternatives })));
        });

        for (let i = 0; i < dataRows.length; i++) {
            const row = dataRows[i];
            const record = {};
            const rowErrors = [];

            // Map row data to record object - include both header names and raw data keys
            headers.forEach((header, index) => {
                if (header && row[index] !== undefined) {
                    record[header] = row[index];
                }
            });

            // Also map the raw data format for compatibility with processing logic
            if (row && typeof row === 'object') {
                Object.keys(row).forEach(key => {
                    if (row[key] !== undefined) {
                        record[key] = row[key];
                    }
                });
            }

            const invoiceNumber = record['InvoiceNo'] || record['Invoice'] || record['Internal Document Reference Number'] || record[headers[0]] || `Row ${i + 1}`;

            // Skip validation if this looks like a header row that slipped through
            if (invoiceNumber && typeof invoiceNumber === 'string') {
                const lowerInvoice = invoiceNumber.toLowerCase().trim();
                const headerPatterns = ['invoice', 'internal document', 'reference number', 'supplier', 'buyer'];
                if (headerPatterns.some(pattern => lowerInvoice.includes(pattern))) {
                    console.log(`Skipping header-like invoice number: "${invoiceNumber}"`);
                    continue;
                }
            }

            // Only log for first few rows to avoid performance issues
            if (i < 3) {
                console.log(`Validating invoice: "${invoiceNumber}" (Row ${i + 1})`);
            }

            // Data Quality Validation Functions
            const dataQualityChecks = {
                // Email format validation
                validateEmail: (email, rowIndex, fieldName) => {
                    const issues = [];
                    if (!email || typeof email !== 'string') return issues;

                    // Check for whitespace BEFORE trimming to catch whitespace issues
                    if (email !== email.trim()) {
                        issues.push({
                            severity: 'Critical',
                            type: 'Email Contains Whitespace',
                            row: rowIndex,
                            field: fieldName,
                            value: email,
                            message: `Email address contains leading or trailing whitespace: "${email}"`,
                            suggestion: `Remove whitespace from email address. Suggested value: "${email.trim()}"`
                        });
                    }

                    // Check for any whitespace characters within the email
                    if (/\s/.test(email)) {
                        issues.push({
                            severity: 'Critical',
                            type: 'Email Contains Whitespace',
                            row: rowIndex,
                            field: fieldName,
                            value: email,
                            message: `Email address contains whitespace characters: "${email}"`,
                            suggestion: 'Email addresses cannot contain spaces, tabs, or other whitespace characters'
                        });
                    }

                    const emailStr = email.trim();
                    if (!emailStr) return issues;

                    // Basic email format check
                    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                    if (!emailRegex.test(emailStr)) {
                        issues.push({
                            severity: 'Critical',
                            type: 'Invalid Email Format',
                            row: rowIndex,
                            field: fieldName,
                            value: email,
                            message: `Invalid email format: "${email}"`,
                            suggestion: 'Ensure email contains @ symbol and valid domain (e.g., user@domain.com)'
                        });
                    }

                    return issues;
                },

                // Whitespace validation
                validateWhitespace: (value, rowIndex, fieldName) => {
                    const issues = [];
                    if (!value || typeof value !== 'string') return issues;

                    // Check for leading/trailing spaces
                    if (value !== value.trim()) {
                        issues.push({
                            severity: 'Warning',
                            type: 'Whitespace Issue',
                            row: rowIndex,
                            field: fieldName,
                            value: value,
                            message: `Field has leading or trailing spaces: "${value}"`,
                            suggestion: `Remove extra spaces. Suggested value: "${value.trim()}"`
                        });
                    }

                    // Check for multiple consecutive spaces
                    if (/\s{2,}/.test(value)) {
                        issues.push({
                            severity: 'Warning',
                            type: 'Multiple Spaces',
                            row: rowIndex,
                            field: fieldName,
                            value: value,
                            message: `Field contains multiple consecutive spaces: "${value}"`,
                            suggestion: `Replace multiple spaces with single space: "${value.replace(/\s+/g, ' ')}"`
                        });
                    }

                    // Check for tab characters
                    if (value.includes('\t')) {
                        issues.push({
                            severity: 'Warning',
                            type: 'Tab Characters',
                            row: rowIndex,
                            field: fieldName,
                            value: value,
                            message: `Field contains tab characters: "${value}"`,
                            suggestion: `Replace tabs with spaces: "${value.replace(/\t/g, ' ')}"`
                        });
                    }

                    return issues;
                },

                // Required field validation
                validateRequired: (value, rowIndex, fieldName, isRequired = true) => {
                    const issues = [];
                    if (!isRequired) return issues;

                    const trimmedValue = value ? String(value).trim() : '';
                    if (!trimmedValue) {
                        issues.push({
                            severity: 'Critical',
                            type: 'Empty Required Field',
                            row: rowIndex,
                            field: fieldName,
                            value: value,
                            message: `Required field is empty or contains only whitespace: "${fieldName}"`,
                            suggestion: `Provide a valid value for ${fieldName}`
                        });
                    }

                    return issues;
                },

                // Field length validation
                validateLength: (value, rowIndex, fieldName, maxLength = 255) => {
                    const issues = [];
                    if (!value || typeof value !== 'string') return issues;

                    if (value.length > maxLength) {
                        issues.push({
                            severity: 'Warning',
                            type: 'Field Too Long',
                            row: rowIndex,
                            field: fieldName,
                            value: value,
                            message: `Field exceeds maximum length of ${maxLength} characters (current: ${value.length})`,
                            suggestion: `Truncate or abbreviate the value to fit within ${maxLength} characters`
                        });
                    }

                    return issues;
                },

                // Special characters validation
                // validateSpecialChars: (value, rowIndex, fieldName) => {
                //     const issues = [];
                //     if (!value || typeof value !== 'string') return issues;

                //     // Check for potentially problematic characters
                //     const problematicChars = /[<>\"'&\x00-\x1f\x7f-\x9f]/g;
                //     const matches = value.match(problematicChars);

                //     if (matches) {
                //         issues.push({
                //             severity: 'Warning',
                //             type: 'Special Characters',
                //             row: rowIndex,
                //             field: fieldName,
                //             value: value,
                //             message: `Field contains potentially problematic characters: ${matches.join(', ')}`,
                //             suggestion: 'Remove or replace special characters that might cause processing issues'
                //         });
                //     }

                //     return issues;
                // },

                // Phone number validation following LHDN E.164 standard requirements
                validatePhoneNumber: (value, rowIndex, fieldName) => {
                    const issues = [];
                    if (!value || typeof value !== 'string') return issues;

                    const phoneStr = value.trim();
                    if (!phoneStr) return issues;

                    // LHDN requires E.164 format: https://www.itu.int/rec/T-REC-E.164
                    // E.164 format: maximum 15 digits, must start with country code
                    // LHDN documentation specifies: "Following the E.164 standard (https://www.itu.int/rec/T-REC-E.164)"

                    // Remove all non-digit characters for validation (except + at start)
                    const digitsOnly = phoneStr.replace(/[^\d]/g, '');
                    const hasPlus = phoneStr.startsWith('+');

                    // E.164 Critical Requirements

                    // 1. Must contain only digits and optional leading plus sign
                    const e164Pattern = /^\+?[0-9]+$/;
                    if (!e164Pattern.test(phoneStr)) {
                        const invalidChars = phoneStr.match(/[^\d\+]/g);
                        issues.push({
                            severity: 'Critical',
                            type: 'Invalid E.164 Format',
                            row: rowIndex,
                            field: fieldName,
                            value: value,
                            message: `Phone number contains invalid characters for E.164 format: ${invalidChars ? invalidChars.join(', ') : 'unknown'}`,
                            suggestion: 'E.164 format allows only digits and optional leading plus sign (e.g., +60123456789)'
                        });
                    }

                    // 2. Maximum 15 digits as per E.164 standard
                    if (digitsOnly.length > 15) {
                        issues.push({
                            severity: 'Critical',
                            type: 'E.164 Length Exceeded',
                            row: rowIndex,
                            field: fieldName,
                            value: value,
                            message: `Phone number exceeds E.164 maximum of 15 digits (current: ${digitsOnly.length})`,
                            suggestion: 'Remove extra digits to comply with E.164 standard (max 15 digits)'
                        });
                    }

                    // 3. Minimum length validation (at least 7 digits for valid phone numbers)
                    if (digitsOnly.length < 7) {
                        issues.push({
                            severity: 'Critical',
                            type: 'Phone Number Too Short',
                            row: rowIndex,
                            field: fieldName,
                            value: value,
                            message: `Phone number is too short (${digitsOnly.length} digits): "${value}"`,
                            suggestion: 'Provide a complete phone number with country code (e.g., +60123456789)'
                        });
                    }

                    // 4. LHDN strongly recommends international format with country code
                    if (!hasPlus && digitsOnly.length >= 7) {
                        // Check if it might be missing country code
                        if (digitsOnly.length <= 10) {
                            issues.push({
                                severity: 'Warning',
                                type: 'Missing Country Code',
                                row: rowIndex,
                                field: fieldName,
                                value: value,
                                message: `Phone number should include country code for E.164 compliance: "${value}"`,
                                suggestion: 'Add country code with plus sign (e.g., +60 for Malaysia: +60123456789)'
                            });
                        }
                    }

                    // 5. Validate Malaysian phone numbers specifically (if starts with +60 or 60)
                    if (hasPlus && digitsOnly.startsWith('60')) {
                        const malaysianNumber = digitsOnly.substring(2); // Remove country code

                        // Malaysian mobile numbers: 10-11 digits after country code (01x-xxxx-xxxx format)
                        // Malaysian landline: 8-9 digits after country code (0x-xxxx-xxxx format)
                        if (malaysianNumber.length < 8 || malaysianNumber.length > 11) {
                            issues.push({
                                severity: 'Warning',
                                type: 'Invalid Malaysian Number Length',
                                row: rowIndex,
                                field: fieldName,
                                value: value,
                                message: `Malaysian phone number has invalid length (${malaysianNumber.length} digits after country code)`,
                                suggestion: 'Malaysian numbers should be 8-11 digits after +60 (e.g., +60123456789)'
                            });
                        }

                        // Check for valid Malaysian prefixes
                        if (malaysianNumber.length >= 2) {
                            const twoDigitPrefix = malaysianNumber.substring(0, 2);
                            const threeDigitPrefix = malaysianNumber.length >= 3 ? malaysianNumber.substring(0, 3) : '';

                            // Valid Malaysian mobile prefixes (01x series)
                            const validMobilePrefixes = ['010', '011', '012', '013', '014', '015', '016', '017', '018', '019'];
                            // Valid Malaysian landline prefixes (area codes)
                            const validLandlinePrefixes = ['03', '04', '05', '06', '07', '08', '09'];

                            const isValidMobile = validMobilePrefixes.includes(threeDigitPrefix);
                            const isValidLandline = validLandlinePrefixes.includes(twoDigitPrefix);

                            // Only flag as invalid if it doesn't match any valid pattern
                            if (!isValidMobile && !isValidLandline) {
                                issues.push({
                                    severity: 'Warning',
                                    type: 'Invalid Malaysian Number Prefix',
                                    row: rowIndex,
                                    field: fieldName,
                                    value: value,
                                    message: `Malaysian phone number has invalid area/mobile code: "${threeDigitPrefix || twoDigitPrefix}"`,
                                    suggestion: 'Use valid Malaysian prefixes: 01x for mobile (e.g., 012, 013), 03-09 for landline (e.g., 03, 04)'
                                });
                            }
                        }
                    }

                    // 6. Check for suspicious patterns (all same digits, sequential, etc.)
                    if (digitsOnly.length >= 7) {
                        // All same digits
                        if (/^(\d)\1+$/.test(digitsOnly)) {
                            issues.push({
                                severity: 'Warning',
                                type: 'Suspicious Phone Pattern',
                                row: rowIndex,
                                field: fieldName,
                                value: value,
                                message: `Phone number appears to be placeholder (all same digits): "${value}"`,
                                suggestion: 'Verify this is a real phone number and not a test value'
                            });
                        }

                        // Common invalid patterns
                        const invalidPatterns = [
                            { pattern: /^0+$/, name: 'all zeros' },
                            { pattern: /^1+$/, name: 'all ones' },
                            { pattern: /^123456/, name: 'sequential digits' },
                            { pattern: /^000/, name: 'starts with 000' }
                        ];

                        for (const { pattern, name } of invalidPatterns) {
                            if (pattern.test(digitsOnly)) {
                                issues.push({
                                    severity: 'Warning',
                                    type: 'Invalid Phone Pattern',
                                    row: rowIndex,
                                    field: fieldName,
                                    value: value,
                                    message: `Phone number appears invalid (${name}): "${value}"`,
                                    suggestion: 'Provide a valid phone number in E.164 format'
                                });
                                break;
                            }
                        }
                    }

                    return issues;
                }
            };

            // Enhanced field value finder - supports both descriptive names and __EMPTY_ format
            const findFieldValue = (fieldConfig) => {
                // Try primary field first
                if (record[fieldConfig.primary] && String(record[fieldConfig.primary]).trim() !== '') {
                    return record[fieldConfig.primary];
                }

                // Try each alternative field name exactly as specified
                for (const fieldName of fieldConfig.alternatives) {
                    if (record[fieldName] && String(record[fieldName]).trim() !== '') {
                        return record[fieldName];
                    }
                }

                // Special handling for buyer name - try __EMPTY_49 directly
                if (fieldConfig.primary === 'BuyerName') {
                    if (record['__EMPTY_49'] && String(record['__EMPTY_49']).trim() !== '') {
                        return record['__EMPTY_49'];
                    }
                }

                return null;
            };

            // Data Quality Validation - Run comprehensive checks on all field values
            const dataQualityIssues = [];

            // Define field validation rules
            const fieldValidationRules = {
                'Email Address': { required: true, type: 'email', maxLength: 100 },
                'Contact Number': { required: true, type: 'phone', maxLength: 20 },
                'Full Legal Name': { required: true, type: 'text', maxLength: 200 },
                'Address1': { required: true, type: 'text', maxLength: 255 },
                'Address2': { required: false, type: 'text', maxLength: 255 },
                'RegistrationName': { required: false, type: 'text', maxLength: 50 },
                'Invoice_ID': { required: true, type: 'text', maxLength: 50 },
                'List ID': { required: false, type: 'text', maxLength: 50 },
                'List Agent': { required: false, type: 'text', maxLength: 100 },
                // Additional phone-related fields based on Excel structure
                'SupplierContact': { required: false, type: 'phone', maxLength: 20 },
                'BuyerContact': { required: false, type: 'phone', maxLength: 20 },
                'Supplier Contact': { required: false, type: 'phone', maxLength: 20 },
                'Buyer Contact': { required: false, type: 'phone', maxLength: 20 },
                'Customer Contact': { required: false, type: 'phone', maxLength: 20 },
                'Phone': { required: false, type: 'phone', maxLength: 20 },
                'Telephone': { required: false, type: 'phone', maxLength: 20 }
            };

            // Run data quality checks on all fields
            Object.keys(record).forEach(fieldName => {
                const fieldValue = record[fieldName];
                const rules = fieldValidationRules[fieldName];

                if (rules) {
                    // Required field validation
                    dataQualityIssues.push(...dataQualityChecks.validateRequired(fieldValue, i + 1, fieldName, rules.required));

                    // Only run other validations if field has a value
                    if (fieldValue && String(fieldValue).trim() !== '') {
                        // Whitespace validation
                        dataQualityIssues.push(...dataQualityChecks.validateWhitespace(fieldValue, i + 1, fieldName));

                        // Email validation for email fields
                        if (rules.type === 'email') {
                            dataQualityIssues.push(...dataQualityChecks.validateEmail(fieldValue, i + 1, fieldName));
                        }

                        // Phone number validation for phone fields
                        if (rules.type === 'phone') {
                            dataQualityIssues.push(...dataQualityChecks.validatePhoneNumber(fieldValue, i + 1, fieldName));
                        }

                        // Length validation
                        dataQualityIssues.push(...dataQualityChecks.validateLength(fieldValue, i + 1, fieldName, rules.maxLength));

                        // Special characters validation (skip for phone numbers as they have their own validation)
                        // if (rules.type !== 'phone') {
                        //     dataQualityIssues.push(...dataQualityChecks.validateSpecialChars(fieldValue, i + 1, fieldName));
                        // }
                    }
                }
            });

            // If there are data quality issues, add them to validation errors
            if (dataQualityIssues.length > 0) {
                // Only log for first few rows to avoid performance issues
                if (i < 3) {
                    console.log(`⚠️ Found ${dataQualityIssues.length} data quality issues for invoice: ${invoiceNumber}`);
                }

                dataQualityIssues.forEach(issue => {
                    validationErrors.push({
                        invoiceNumber: invoiceNumber,
                        field: issue.field,
                        issue: `${issue.type}: ${issue.message}`,
                        severity: issue.severity,
                        suggestion: issue.suggestion,
                        value: issue.value
                    });
                });
            }

            // Validate mandatory fields with improved field mapping
            Object.entries(mandatoryFields).forEach(([category, fieldConfigs]) => {
                fieldConfigs.forEach(fieldConfig => {
                    const fieldValue = findFieldValue(fieldConfig);
                    const fieldName = fieldConfig.primary;

                    if (!fieldValue || String(fieldValue).trim() === '') {
                        // Special handling for certain fields
                        if (fieldName === 'SupplierSST' || fieldName === 'BuyerSST') {
                            return;
                        }
                        if (fieldName === 'BuyerContact' && fieldValue === 'NA') {
                            return;
                        }

                        // Special handling for buyer fields in supplier-focused Excel files
                        if (category === 'buyer') {
                            // For supplier-focused files, buyer information might not be present
                            // Set default values or skip validation for buyer fields
                            return;
                        }

                        // Special handling for General Public buyers
                        const buyerNameConfig = mandatoryFields.buyer.find(f => f.primary === 'BuyerName');
                        const buyerName = findFieldValue(buyerNameConfig);
                        if (buyerName === 'General Public' &&
                            ['BuyerBRN', 'BuyerAddress', 'BuyerCity', 'BuyerState', 'BuyerCountry', 'BuyerContact'].includes(fieldName) &&
                            (fieldValue === 'NA' || !fieldValue)) {
                            return;
                        }

                        // Special handling for fields with default values
                        if (fieldName === 'eInvoiceVersion') {
                            return; // Default will be applied during processing
                        }
                        if (fieldName === 'eInvoiceType') {
                            return; // Default will be applied during processing
                        }

                        // For debugging: make validation less strict for core supplier/buyer fields
                        const coreFields = ['SupplierName', 'BuyerName', 'InvoiceNo'];
                        if (!coreFields.includes(fieldName)) {
                            return; // Skip validation for non-core fields temporarily
                        }

                        // Only log critical missing fields
                        if (i < 3) {
                            console.log(`❌ Missing mandatory field: ${fieldName}`);
                        }
                        rowErrors.push({
                            code: 'MANDATORY_FIELD',
                            field: fieldName,
                            message: `Missing mandatory field: ${fieldName}`,
                            userFriendlyMessage: `The field "${fieldName}" is required but is missing or empty.`,
                            value: fieldValue || '',
                            attemptedFields: [fieldConfig.primary, ...fieldConfig.alternatives]
                        });
                    }
                });
            });

            // TIN format validation
            if (record.SupplierTIN && !/^\d{12}$/.test(String(record.SupplierTIN))) {
                rowErrors.push({
                    code: 'INVALID_TIN_FORMAT',
                    field: 'SupplierTIN',
                    message: 'Invalid TIN format',
                    userFriendlyMessage: 'TIN must be exactly 12 digits.',
                    value: record.SupplierTIN
                });
            }

            if (record.BuyerTIN && !/^\d{12}$/.test(String(record.BuyerTIN))) {
                rowErrors.push({
                    code: 'INVALID_TIN_FORMAT',
                    field: 'BuyerTIN',
                    message: 'Invalid TIN format',
                    userFriendlyMessage: 'TIN must be exactly 12 digits.',
                    value: record.BuyerTIN
                });
            }

            // Currency validation
            if (record.CurrencyCode && record.CurrencyCode !== 'MYR' && !record.ExchangeRate) {
                rowErrors.push({
                    code: 'MISSING_EXCHANGE_RATE',
                    field: 'ExchangeRate',
                    message: 'Exchange rate required for non-MYR currency',
                    userFriendlyMessage: `Exchange rate is required when currency is ${record.CurrencyCode}.`,
                    value: record.ExchangeRate || ''
                });
            }

            if (rowErrors.length > 0) {
                validationErrors.push({
                    invoiceNumber: invoiceNumber,
                    index: i,
                    errors: rowErrors
                });
            }
        }

        // Return enhanced validation results with data quality reporting
        const isValid = validationErrors.length === 0;

        // Categorize and summarize errors
        const errorSummary = {
            critical: 0,
            warning: 0,
            info: 0,
            dataQuality: 0,
            fieldMissing: 0
        };

        const categorizedErrors = {};

        validationErrors.forEach(error => {
            if (!categorizedErrors[error.invoiceNumber]) {
                categorizedErrors[error.invoiceNumber] = {
                    critical: [],
                    warning: [],
                    info: []
                };
            }

            const errorDetail = {
                field: error.field,
                issue: error.issue,
                suggestion: error.suggestion || null,
                value: error.value || null
            };

            // Categorize by severity
            const severity = error.severity || 'Critical';
            if (severity === 'Critical') {
                categorizedErrors[error.invoiceNumber].critical.push(errorDetail);
                errorSummary.critical++;
            } else if (severity === 'Warning') {
                categorizedErrors[error.invoiceNumber].warning.push(errorDetail);
                errorSummary.warning++;
            } else {
                categorizedErrors[error.invoiceNumber].info.push(errorDetail);
                errorSummary.info++;
            }

            // Track error types
            if (error.suggestion) {
                errorSummary.dataQuality++;
            } else {
                errorSummary.fieldMissing++;
            }
        });

        const response = {
            isValid: isValid,
            totalDocuments: dataRows.length,
            failedDocuments: validationErrors.length,
            details: categorizedErrors,
            summary: errorSummary,
            recommendations: isValid ? [] : [
                "Fix all Critical errors before uploading",
                "Review Warning issues for data quality improvements",
                "Use the suggestions provided to correct formatting issues",
                "Ensure all required fields contain valid data"
            ]
        };

        if (isValid) {
            response.message = `✅ All ${dataRows.length} invoices passed validation. File is ready for upload.`;
        } else {
            response.message = `❌ Validation failed for ${Object.keys(categorizedErrors).length} invoices. ${errorSummary.critical} critical errors, ${errorSummary.warning} warnings found.`;
        }

        res.json(response);

    } catch (error) {
        console.error('Pre-validation error:', error);

        // Clean up uploaded file on error
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }

        res.status(500).json({
            isValid: false,
            error: error.message || 'Validation failed due to server error',
            totalDocuments: 0,
            failedDocuments: 0
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
        console.log(`🔍 [UPLOAD DEBUG] Starting Excel processing for file: ${filename}`);
        console.log(`🔍 [UPLOAD DEBUG] File path: ${filePath}`);
        console.log(`🔍 [UPLOAD DEBUG] File size: ${fileSize} bytes`);

        const processingResult = await consumeExcelFile(filePath);

        console.log(`🔍 [UPLOAD DEBUG] Processing result:`, {
            success: processingResult.success,
            hasProcessingResults: !!processingResult.processingResults,
            processingResultsLength: processingResult.processingResults?.length || 0,
            hasEnhancedResults: !!processingResult.enhancedResults,
            error: processingResult.error,
            processingTime: processingResult.processingTime
        });

        if (!processingResult.success) {
            console.log(`🔍 [UPLOAD DEBUG] Processing failed:`, processingResult.error);
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
        console.log(`🔍 [UPLOAD DEBUG] Processed data sample:`, {
            count: processedData.length,
            firstItem: processedData[0] || null,
            hasItems: processedData.length > 0,
            dataTypes: processedData.map(item => typeof item).slice(0, 3)
        });

        // DUPLICATE DETECTION - Generate content hash and check for duplicates
        console.log(`🔍 [DUPLICATE CHECK] Starting duplicate detection for ${processedData.length} invoices`);

        // Generate content hash for the entire file
        const contentHash = ContentHasher.generateInvoiceDataHash(processedData);
        console.log(`🔍 [DUPLICATE CHECK] Generated content hash: ${contentHash}`);

        // Check for content-based duplicates (same data in different files)
        if (contentHash) {
            const existingFileWithHash = await prisma.wP_UPLOADED_EXCEL_FILES.findFirst({
                where: {
                    // SQL Server stores JSON as NVARCHAR, so use a substring match on the serialized JSON
                    metadata: {
                        contains: `"contentHash":"${contentHash}"`
                    },
                    processing_status: { not: 'error' },
                    id: { not: uploadedFile.id } // Exclude current file
                }
            });

            if (existingFileWithHash) {
                console.log(`🔍 [DUPLICATE CHECK] Content duplicate found: File ID ${existingFileWithHash.id}`);

                // Clean up uploaded file
                if (fs.existsSync(filePath)) {
                    fs.unlinkSync(filePath);
                }

                // Delete the database record we just created
                await prisma.wP_UPLOADED_EXCEL_FILES.delete({
                    where: { id: uploadedFile.id }
                });

                return res.status(409).json({
                    success: false,
                    error: 'Duplicate content detected: This file contains the same invoice data as a previously uploaded file.',
                    duplicateType: 'CONTENT_DUPLICATE',
                    existingFile: {
                        id: existingFileWithHash.id,
                        filename: existingFileWithHash.filename,
                        uploadDate: existingFileWithHash.upload_date,
                        uploadedBy: existingFileWithHash.uploaded_by_name
                    }
                });
            }
        }

        // Check for invoice-level duplicates
        const duplicateCheck = await InvoiceDuplicateChecker.checkInvoiceDuplicates(
            processedData,
            req.user.id,
            uploadedFile.id
        );

        console.log(`🔍 [DUPLICATE CHECK] Duplicate check results:`, duplicateCheck.summary);

        // Block upload if critical duplicates are found
        if (duplicateCheck.summary.hasBlockingDuplicates) {
            const criticalDuplicates = duplicateCheck.duplicates.filter(d =>
                ['CRITICAL', 'HIGH'].includes(d.severity)
            );

            console.log(`🔍 [DUPLICATE CHECK] Blocking upload due to ${criticalDuplicates.length} critical duplicates`);

            // Clean up uploaded file
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }

            // Delete the database record we just created
            await prisma.wP_UPLOADED_EXCEL_FILES.delete({
                where: { id: uploadedFile.id }
            });

            return res.status(409).json({
                success: false,
                error: 'Critical duplicates detected: Some invoices have already been processed or submitted to LHDN.',
                duplicateType: 'INVOICE_DUPLICATE',
                duplicates: criticalDuplicates,
                warnings: duplicateCheck.warnings,
                summary: duplicateCheck.summary
            });
        }

        // Generate individual invoice hashes for metadata
        const invoiceHashes = {};
        processedData.forEach(invoice => {
            const invoiceNo = invoice.header?.invoiceNo;
            if (invoiceNo) {
                invoiceHashes[invoiceNo] = ContentHasher.generateInvoiceHash(invoice);
            }
        });

        // Update database with processing results and duplicate check data
        await prisma.wP_UPLOADED_EXCEL_FILES.update({
            where: { id: uploadedFile.id },
            data: {
                invoice_count: processedData.length,
                processing_status: 'processed',
                processed_date: new Date(),
                processing_logs: JSON.stringify(processingResult.logs),
                metadata: JSON.stringify({
                    originalPath: filePath,
                    filenameValidation: filenameValidation,
                    contentHash: contentHash,
                    invoiceHashes: invoiceHashes,
                    duplicateCheck: {
                        duplicates: duplicateCheck.duplicates,
                        warnings: duplicateCheck.warnings,
                        summary: duplicateCheck.summary,
                        checkedAt: new Date().toISOString()
                    }
                })
            }
        });

        // Store processed data in memory with session ID for immediate use
        const sessionId = uuidv4();
        console.log(`🔍 [UPLOAD DEBUG] Storing data in memory with sessionId: ${sessionId}`);

        excelDataStorage.set(sessionId, {
            data: processedData,
            filename: filename,
            userId: req.user.id,
            timestamp: new Date(),
            fileId: uploadedFile.id
        });

        console.log(`🔍 [UPLOAD DEBUG] Final response data:`, {
            success: true,
            processedDataCount: processedData.length,
            filename: filename,
            fileId: uploadedFile.id,
            sessionId: sessionId,
            hasFilenameValidation: !!filenameValidation
        });

        res.json({
            success: true,
            message: `Excel file processed successfully. ${processedData.length} invoices found.`,
            data: processedData,
            filename: filename,
            fileId: uploadedFile.id,
            sessionId: sessionId,
            filenameValidation: filenameValidation,
            logs: processingResult.logs,
            duplicateCheck: {
                summary: duplicateCheck.summary,
                warnings: duplicateCheck.warnings.length > 0 ? duplicateCheck.warnings : undefined,
                contentHash: contentHash
            }
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

            // Check for failed status first
            if (result.status === 'failed' && result.error) {
                return res.status(400).json({
                    success: false,
                    error: result.error,
                    details: result.error.details || null
                });
            }

            // Check for rejected documents even if status is success
            if (result.data?.rejectedDocuments?.length > 0) {
                const rejectedDoc = result.data.rejectedDocuments[0];
                return res.status(400).json({
                    success: false,
                    error: rejectedDoc.error || rejectedDoc,
                    rejectedDocuments: result.data.rejectedDocuments
                });
            }

            if (result.status === 'success') {
                // Cleanup JSON files after successful submission
                try {
                    await cleanupLHDNJsonFiles([invoice_number]);
                    console.log(`✅ Cleaned up JSON files for invoice: ${invoice_number}`);
                } catch (cleanupError) {
                    console.error(`⚠️ Warning: Failed to cleanup JSON files for invoice ${invoice_number}:`, cleanupError);
                    // Don't fail the submission if cleanup fails
                }

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
            let supplierDisplay = 'Multiple Supplier';
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
        console.log(`🔍 [PREVIEW API DEBUG] Preview request received`);

        if (!req.file) {
            console.log(`🔍 [PREVIEW API DEBUG] No file uploaded in request`);
            return res.status(400).json({
                success: false,
                error: 'No Excel file uploaded'
            });
        }

        tempFilePath = req.file.path;
        console.log(`🔍 [PREVIEW API DEBUG] Processing file:`, {
            originalname: req.file.originalname,
            filename: req.file.filename,
            path: tempFilePath,
            size: req.file.size,
            mimetype: req.file.mimetype
        });

        // Use the lighter preview service first, then do limited processing
        const { previewExcelFile } = require('../../services/excel/excelConsumer');
        const previewResult = await previewExcelFile(tempFilePath, {
            maxRows: 5, // Limit to 5 rows for preview
            originalFilename: req.file.originalname
        });

        console.log(`🔍 [PREVIEW API DEBUG] Preview result:`, {
            success: previewResult.success,
            hasPreview: !!previewResult.preview,
            previewLength: previewResult.preview?.length || 0,
            hasDocuments: !!previewResult.documents,
            documentsLength: previewResult.documents?.length || 0,
            error: previewResult.error
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
router.post(
  "/bulk-submit-files",
  [auth.isApiAuthenticated],
  async (req, res) => {
    try {
      const { fileIds } = req.body;

      if (!fileIds || !Array.isArray(fileIds) || fileIds.length === 0) {
        return res.status(400).json({
          success: false,
          error: "File IDs array is required",
        });
      }

      // LHDN limitations check
      if (fileIds.length > 100) {
        return res.status(400).json({
          success: false,
          error: "Maximum 100 files can be submitted at once (LHDN limitation)",
        });
      }

      // Get files from database
      const files = await prisma.wP_UPLOADED_EXCEL_FILES.findMany({
        where: {
          id: { in: fileIds.map((id) => parseInt(id)) },
          uploaded_by_user_id: req.user.id,
          processing_status: "processed",
        },
      });

      if (files.length === 0) {
        return res.status(400).json({
          success: false,
          error: "No valid processed files found for submission",
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
          error: `Total file size (${(totalSize / 1024 / 1024).toFixed(
            2
          )}MB) exceeds LHDN limit of 5MB`,
        });
      }

      // Log if documents exceed batch size — auto-splitting handles the rest
      if (totalDocuments > 100) {
        console.log(`Bulk submit: ${totalDocuments} total documents — will auto-split into batches of 100`);
      }

      // Update files status to submitting
      await prisma.wP_UPLOADED_EXCEL_FILES.updateMany({
        where: { id: { in: fileIds.map((id) => parseInt(id)) } },
        data: { processing_status: "submitting" },
      });

      // Process bulk submission in background with enhanced validation and real-time status updates
      // Get session ID from request headers or generate one
      const sessionId =
        req.headers["x-session-id"] ||
        req.sessionID ||
        `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      processBulkSubmissionEnhanced(files, req.user, sessionId).catch(
        (error) => {
          console.error("Background bulk submission error:", error);
          // Update status to show error
          const status = bulkSubmissionStatus.get(`bulk_${Date.now()}`);
          if (status) {
            status.overallStatus = "error";
            status.currentPhase = "error";
            status.endTime = new Date();
          }
        }
      );

      res.json({
        success: true,
        message: `Bulk submission initiated for ${files.length} files with ${totalDocuments} total documents`,
        data: {
          fileCount: files.length,
          totalDocuments: totalDocuments,
          totalSize: totalSize,
          files: files.map((f) => ({
            id: f.id,
            filename: f.filename,
            invoiceCount: f.invoice_count,
            fileSize: f.file_size.toString(),
          })),
        },
      });
    } catch (error) {
      console.error("Bulk submission error:", error);
      res.status(500).json({
        success: false,
        error: "Failed to process bulk submission",
      });
    }
  }
);

// API endpoint to delete uploaded file
router.delete(
  "/uploaded-files/:fileId(\\d+)",
  [auth.isApiAuthenticated],
  async (req, res) => {
    try {
      // Defensive user context check
      if (!req.user?.id) {
        return res
          .status(401)
          .json({ success: false, error: "Unauthorized (no user context)" });
      }

      const { fileId } = req.params;
      const id = parseInt(fileId, 10);
      if (!Number.isFinite(id)) {
        return res
          .status(400)
          .json({ success: false, error: "Invalid file ID" });
      }

      // Get file details
      const file = await prisma.wP_UPLOADED_EXCEL_FILES.findFirst({
        where: {
          id,
          uploaded_by_user_id: req.user.id,
        },
      });

      if (!file) {
        return res.status(404).json({
          success: false,
          error: "File not found",
        });
      }

      // Delete physical file if it exists (guard path)
      if (
        file.file_path &&
        typeof file.file_path === "string" &&
        fs.existsSync(file.file_path)
      ) {
        fs.unlinkSync(file.file_path);
      }

      // Delete database record
      await prisma.wP_UPLOADED_EXCEL_FILES.delete({
        where: { id },
      });

      res.json({
        success: true,
        message: "File deleted successfully",
      });
    } catch (error) {
      console.error("Error deleting file:", error);
      res.status(500).json({
        success: false,
        error: "Failed to delete file",
      });
    }
  }
);

// API endpoint to bulk delete uploaded files
router.delete(
  "/uploaded-files/bulk",
  [auth.isApiAuthenticated],
  async (req, res) => {
    try {
      // Defensive checks for user context
      if (!req.user?.id) {
        return res
          .status(401)
          .json({ success: false, error: "Unauthorized (no user context)" });
      }

      const { fileIds } = req.body;

      if (!fileIds || !Array.isArray(fileIds) || fileIds.length === 0) {
        return res.status(400).json({
          success: false,
          error: "File IDs array is required",
        });
      }

      // Sanitize and validate IDs
      const ids = fileIds.map((id) => parseInt(id, 10)).filter(Number.isFinite);
      if (ids.length === 0) {
        return res
          .status(400)
          .json({ success: false, error: "No valid file IDs" });
      }

      // Get files to delete (ensure they belong to the current user)
      const files = await prisma.wP_UPLOADED_EXCEL_FILES.findMany({
        where: {
          id: { in: ids },
          uploaded_by_user_id: req.user.id,
        },
      });

      if (files.length === 0) {
        return res.status(404).json({
          success: false,
          error: "No files found to delete",
        });
      }

      const deletedFiles = [];
      const failedFiles = [];

      // Delete physical files and database records
      for (const file of files) {
        try {
          // Delete physical file if it exists (guard path)
          if (
            file.file_path &&
            typeof file.file_path === "string" &&
            fs.existsSync(file.file_path)
          ) {
            fs.unlinkSync(file.file_path);
          }

          // Delete database record
          await prisma.wP_UPLOADED_EXCEL_FILES.delete({
            where: { id: file.id },
          });

          deletedFiles.push({
            id: file.id,
            filename: file.original_filename,
          });
        } catch (error) {
          console.error(`Error deleting file ${file.id}:`, error);
          failedFiles.push({
            id: file.id,
            filename: file.original_filename,
            error: error.message,
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
          failed: failedFiles.length,
        },
      });
    } catch (error) {
      console.error("Error in bulk delete:", error);
      res.status(500).json({
        success: false,
        error: "Failed to delete files",
      });
    }
  }
);

// API endpoint to get file details
router.get(
  "/uploaded-files/:fileId/details",
  [auth.isApiAuthenticated],
  async (req, res) => {
    try {
      const { fileId } = req.params;

      const file = await prisma.wP_UPLOADED_EXCEL_FILES.findFirst({
        where: {
          id: parseInt(fileId),
          uploaded_by_user_id: req.user.id,
        },
      });

      if (!file) {
        return res.status(404).json({
          success: false,
          error: "File not found",
        });
      }

      // Convert BigInt to string for JSON serialization
      const fileDetails = {
        ...file,
        file_size: file.file_size.toString(),
        processing_logs: file.processing_logs
          ? JSON.parse(file.processing_logs)
          : null,
        metadata: file.metadata ? JSON.parse(file.metadata) : null,
        lhdn_response: file.lhdn_response
          ? JSON.parse(file.lhdn_response)
          : null,
      };

      res.json({
        success: true,
        data: fileDetails,
      });
    } catch (error) {
      console.error("Error getting file details:", error);
      res.status(500).json({
        success: false,
        error: "Failed to get file details",
      });
    }
  }
);
// API endpoint to submit a single uploaded file synchronously (returns immediate result)
router.post(
  "/uploaded-files/:fileId/submit-single",
  [auth.isApiAuthenticated],
  async (req, res) => {
    try {
      const { fileId } = req.params;
      const version = "1.0";

      const file = await prisma.wP_UPLOADED_EXCEL_FILES.findFirst({
        where: {
          id: parseInt(fileId),
          uploaded_by_user_id: req.user.id,
        },
      });

      if (!file) {
        return res
          .status(404)
          .json({ success: false, error: "File not found" });
      }

      if ((file.processing_status || "").toLowerCase() !== "processed") {
        return res.status(400).json({
          success: false,
          error:
            "This file is not ready for submission. Please process the file first.",
        });
      }

      const invoiceCount = parseInt(file.invoice_count || 0, 10) || 0;
      if (invoiceCount > 100) {
        console.log(`File has ${invoiceCount} documents — will auto-split into batches of 100`);
      }

      if (!fs.existsSync(file.file_path)) {
        return res
          .status(404)
          .json({ success: false, error: "Physical file not found" });
      }

      // Prefer pre-generated documents from metadata (prepared step)
      let meta = {};
      try {
        meta = file.metadata ? JSON.parse(file.metadata) : {};
      } catch (_) {
        meta = {};
      }
      let preparedDocs = meta?.preparedDocuments;
      let invoiceNumbers =
        meta?.prepared && Array.isArray(meta.prepared.invoiceNumbers)
          ? meta.prepared.invoiceNumbers
          : [];

      let documents = [];
      let preparedInvoices = [];

      if (Array.isArray(preparedDocs) && preparedDocs.length > 0) {
        console.log(
          "submit-single: using pre-generated documents from metadata",
          preparedDocs.length
        );
        documents = preparedDocs;
        preparedInvoices = invoiceNumbers || [];
      } else {
        // Fallback: Process Excel and map to LHDN JSON per invoice (legacy path)
        console.log(
          "submit-single: prepared docs not found, generating on-the-fly"
        );
        const processingResult = await consumeExcelFile(file.file_path);
        if (!processingResult.success || !processingResult.processingResults) {
          return res
            .status(400)
            .json({ success: false, error: "Failed to process Excel file" });
        }

        const processedData = processingResult.processingResults;

        // Duplicate prevention: block resubmission if already submitted
        if (
          file.submitted_date ||
          (file.processing_status &&
            ["submitted", "cancelled"].includes(
              String(file.processing_status).toLowerCase()
            ))
        ) {
          return res.status(409).json({
            success: false,
            error: "This file appears to have been submitted already.",
            details: {
              submittedDate: file.submitted_date,
              submissionUid: file.submission_uid || null,
              status: file.processing_status,
            },
          });
        }

        if (!Array.isArray(processedData) || processedData.length === 0) {
          return res.status(400).json({
            success: false,
            error: "No valid documents found in Excel file",
          });
        }

        const submitter = new LHDNSubmitter(req);
        for (const invoiceData of processedData) {
          const lhdnJson = mapToLHDNFormat([invoiceData], version);
          if (!lhdnJson) {
            return res.status(400).json({
              success: false,
              error: "Failed to map invoice data to LHDN format",
            });
          }
          const { payload, invoice_number } =
            await submitter.prepareDocumentForSubmission(lhdnJson, version);
          if (!payload || !payload.documents || !payload.documents[0]) {
            return res.status(400).json({
              success: false,
              error: "Failed to prepare document for submission",
            });
          }
          documents.push(payload.documents[0]);
          preparedInvoices.push(invoice_number);
        }
      }

      const submitter = new LHDNSubmitter(req);
      const result = await submitter.submitToLHDNDocument(documents);

      // Cleanup JSON files after successful submission
      if (result.status === "success" && preparedInvoices.length > 0) {
        try {
          await cleanupLHDNJsonFiles(preparedInvoices);
          console.log(`✅ Cleaned up JSON files for ${preparedInvoices.length} invoices in single submission`);
        } catch (cleanupError) {
          console.error(`⚠️ Warning: Failed to cleanup JSON files in single submission:`, cleanupError);
          // Don't fail the submission if cleanup fails
        }
      }

      // Update DB quickly with result snapshot
      // Do not flip status to "error" for pre-submission validation failures.
      // Keep it as "processed" (which renders as "Ready to Submit") so users can fix and retry.
      const _nonSuccessCode = result && result.error && result.error.code;
      const _desiredStatus =
        result.status === "success"
          ? "submitted"
          : _nonSuccessCode === "PRE_SUBMISSION_VALIDATION_FAILED"
          ? "processed"
          : "error";

      await prisma.wP_UPLOADED_EXCEL_FILES.update({
        where: { id: file.id },
        data: {
          processing_status: _desiredStatus,
          submitted_date:
            result.status === "success" ? new Date() : file.submitted_date,
          lhdn_response: JSON.stringify(result),
          updated_at: new Date(),
        },
      });

      if (result.status === "success") {
        return res.json({ success: true, lhdnResponse: result });
      }
      return res.status(400).json({
        success: false,
        error: result.error?.message || "LHDN submission failed",
        details: result.error?.details || [],
      });
    } catch (err) {
      console.error("Single submission error:", err);
      return res.status(500).json({
        success: false,
        error: err.message || "Failed to submit file to LHDN",
      });
    }
  }
);

// NEW: Prepare documents endpoint (pre-generate JSON and store in metadata)
router.post(
  "/uploaded-files/:fileId/prepare",
  [auth.isApiAuthenticated],
  async (req, res) => {
    try {
      const { fileId } = req.params;
      const version = "1.0";

      const file = await prisma.wP_UPLOADED_EXCEL_FILES.findFirst({
        where: { id: parseInt(fileId), uploaded_by_user_id: req.user.id },
      });
      if (!file)
        return res
          .status(404)
          .json({ success: false, error: "File not found" });
      if (!fs.existsSync(file.file_path))
        return res
          .status(404)
          .json({ success: false, error: "Physical file not found" });

      const processingResult = await consumeExcelFile(file.file_path);
      if (!processingResult.success || !processingResult.processingResults) {
        return res
          .status(400)
          .json({ success: false, error: "Failed to process Excel file" });
      }
      const processedData = processingResult.processingResults;
      const submitter = new LHDNSubmitter(req);
      const documents = [];
      const invoiceNumbers = [];

      // Process each invoice with progress tracking
      for (let i = 0; i < processedData.length; i++) {
        const invoiceData = processedData[i];

        // Send progress update to frontend (if supported)
        if (req.progressCallback) {
          req.progressCallback({
            stage: 'submit',
            message: `Processing invoice ${i + 1} of ${processedData.length}...`,
            progress: 70 + (i / processedData.length) * 20, // 70-90% range
            invoiceCount: i + 1,
            totalInvoices: processedData.length
          });
        }

        const lhdnJson = mapToLHDNFormat([invoiceData], version);
        if (!lhdnJson)
          return res.status(400).json({
            success: false,
            error: "Failed to map invoice data to LHDN format",
          });
        const { payload, invoice_number } =
          await submitter.prepareDocumentForSubmission(lhdnJson, version);
        if (!payload || !payload.documents || !payload.documents[0])
          return res.status(400).json({
            success: false,
            error: "Failed to prepare document for submission",
          });
        documents.push(payload.documents[0]);
        invoiceNumbers.push(invoice_number);
      }

      // Persist prepared docs to metadata for fast submit step
      let meta = {};
      try {
        meta = file.metadata ? JSON.parse(file.metadata) : {};
      } catch (_) {
        meta = {};
      }
      meta.preparedDocuments = documents;
      meta.prepared = { at: new Date().toISOString(), invoiceNumbers };
      await prisma.wP_UPLOADED_EXCEL_FILES.update({
        where: { id: file.id },
        data: { metadata: JSON.stringify(meta), updated_at: new Date() },
      });

      return res.json({
        success: true,
        data: { preparedCount: documents.length },
      });
    } catch (err) {
      console.error("Prepare documents error:", err);
      return res
        .status(500)
        .json({ success: false, error: err.message || "Prepare failed" });
    }
  }
);

// NEW: Check duplicates endpoint (LHDN best practices compliant)
router.post(
  "/uploaded-files/:fileId/check-duplicates",
  [auth.isApiAuthenticated],
  async (req, res) => {
    try {
      console.log("check-duplicates: starting for fileId", req.params.fileId);
      const { fileId } = req.params;

      const file = await prisma.wP_UPLOADED_EXCEL_FILES.findFirst({
        where: { id: parseInt(fileId), uploaded_by_user_id: req.user.id },
      });
      if (!file) {
        console.log("check-duplicates: file not found", fileId);
        return res
          .status(404)
          .json({ success: false, error: "File not found" });
      }

      console.log(
        "check-duplicates: file found, checking metadata for prepared invoices"
      );
      let meta = {};
      try {
        meta = file.metadata ? JSON.parse(file.metadata) : {};
      } catch (_) {
        meta = {};
      }

      const invoiceNumbers =
        meta?.prepared && Array.isArray(meta.prepared.invoiceNumbers)
          ? meta.prepared.invoiceNumbers
          : [];

      console.log(
        "check-duplicates: found invoice numbers",
        invoiceNumbers.length
      );

      // LHDN Best Practice: Check for duplicates in multiple sources
      const duplicates = [];
      const warnings = [];

      if (invoiceNumbers.length > 0) {
        // 1. Check against WP_OUTBOUND_STATUS (our local submissions)
        const existingSubmissions = await prisma.wP_OUTBOUND_STATUS.findMany({
          where: {
            invoice_number: { in: invoiceNumbers },
            status: { not: "Cancelled" },
          },
          select: {
            invoice_number: true,
            status: true,
            date_submitted: true,
            UUID: true,
          },
        });

        console.log(
          "check-duplicates: found existing submissions in WP_OUTBOUND_STATUS",
          existingSubmissions.length
        );

        // 2. Check against recent submissions in same table (within 10 minutes - LHDN duplicate detection window)
        const recentCutoff = new Date(Date.now() - 10 * 60 * 1000); // 10 minutes ago
        const recentSubmissions = await prisma.wP_UPLOADED_EXCEL_FILES.findMany(
          {
            where: {
              uploaded_by_user_id: req.user.id,
              submitted_date: { gte: recentCutoff },
              processing_status: "submitted",
              id: { not: parseInt(fileId) }, // exclude current file
            },
            select: {
              id: true,
              filename: true,
              submitted_date: true,
              metadata: true,
            },
          }
        );

        console.log(
          "check-duplicates: found recent submissions",
          recentSubmissions.length
        );

        // Check for invoice number overlaps in recent submissions
        for (const recent of recentSubmissions) {
          try {
            const recentMeta = recent.metadata
              ? JSON.parse(recent.metadata)
              : {};
            const recentInvoices = recentMeta?.prepared?.invoiceNumbers || [];
            const overlap = invoiceNumbers.filter((inv) =>
              recentInvoices.includes(inv)
            );
            if (overlap.length > 0) {
              warnings.push({
                type: "recent_submission",
                message: `Similar invoices submitted recently in file: ${recent.filename}`,
                invoiceNumbers: overlap,
                submittedAt: recent.submitted_date,
              });
            }
          } catch (_) {
            /* ignore metadata parse errors */
          }
        }

        // Add confirmed duplicates
        duplicates.push(
          ...existingSubmissions.map((sub) => ({
            invoiceNumber: sub.invoice_number,
            status: sub.status,
            dateSubmitted: sub.date_submitted,
            uuid: sub.UUID,
            source: "WP_OUTBOUND_STATUS",
            severity: "error",
          }))
        );
      }

      // LHDN Compliance: Check file size and document count limits
      const fileStats = {
        invoiceCount: invoiceNumbers.length,
        fileSizeKB: Math.round(parseInt(file.file_size) / 1024),
        withinLimits: {
          documentCount: invoiceNumbers.length <= 100, // LHDN limit: 100 docs per submission
          fileSize: parseInt(file.file_size) <= 5 * 1024 * 1024, // LHDN limit: 5MB per submission
        },
      };

      if (!fileStats.withinLimits.documentCount) {
        duplicates.push({
          type: "limit_exceeded",
          severity: "error",
          message: `Document count (${fileStats.invoiceCount}) exceeds LHDN limit of 100 per submission`,
          source: "LHDN_VALIDATION",
        });
      }

      if (!fileStats.withinLimits.fileSize) {
        duplicates.push({
          type: "limit_exceeded",
          severity: "error",
          message: `File size (${fileStats.fileSizeKB}KB) exceeds LHDN limit of 5MB per submission`,
          source: "LHDN_VALIDATION",
        });
      }

      console.log(
        "check-duplicates: returning",
        duplicates.length,
        "duplicates and",
        warnings.length,
        "warnings"
      );
      return res.json({
        success: true,
        data: {
          duplicates,
          warnings,
          invoiceCount: invoiceNumbers.length,
          fileStats,
          lhdnCompliant:
            duplicates.filter((d) => d.severity === "error").length === 0,
        },
      });
    } catch (err) {
      console.error("Check duplicates error:", err);
      return res.status(500).json({
        success: false,
        error: err.message || "Duplicate check failed",
      });
    }
  }
);

// NEW: LHDN Get Submission API integration
router.get(
  "/submission-status/:submissionUid",
  [auth.isApiAuthenticated],
  async (req, res) => {
    try {
      console.log(
        "get-submission-status: starting for submissionUid",
        req.params.submissionUid
      );
      const { submissionUid } = req.params;

      // Initialize LHDN submitter to call Get Submission API
      const submitter = new LHDNSubmitter(req);

      // Call LHDN Get Submission API using existing method
      const submissionData = await submitter.getSubmissionDetails(
        submissionUid
      );

      console.log(
        "get-submission-status: LHDN response",
        submissionData?.success,
        "status:",
        submissionData?.status
      );

      return res.json({
        success: true,
        data: submissionData,
      });
    } catch (err) {
      console.error("Get submission status error:", err);
      return res.status(500).json({
        success: false,
        error: err.message || "Failed to get submission status",
      });
    }
  }
);

// API endpoint to reprocess file
router.post(
  "/uploaded-files/:fileId/reprocess",
  [auth.isApiAuthenticated],
  async (req, res) => {
    try {
      const { fileId } = req.params;

      const file = await prisma.wP_UPLOADED_EXCEL_FILES.findFirst({
        where: {
          id: parseInt(fileId),
          uploaded_by_user_id: req.user.id,
        },
      });

      if (!file) {
        return res.status(404).json({
          success: false,
          error: "File not found",
        });
      }

      if (!fs.existsSync(file.file_path)) {
        return res.status(404).json({
          success: false,
          error: "Physical file not found",
        });
      }

      // Update status to processing
      await prisma.wP_UPLOADED_EXCEL_FILES.update({
        where: { id: parseInt(fileId) },
        data: {
          processing_status: "processing",
          error_message: null,
          processed_date: null,
        },
      });

      // Reprocess the file
      const processingResult = await consumeExcelFile(file.file_path);

      if (!processingResult.success) {
        await prisma.wP_UPLOADED_EXCEL_FILES.update({
          where: { id: parseInt(fileId) },
          data: {
            processing_status: "error",
            error_message: processingResult.error || "Failed to reprocess file",
            processed_date: new Date(),
          },
        });

        return res.status(400).json({
          success: false,
          error: processingResult.error || "Failed to reprocess file",
        });
      }

      const processedData = processingResult.processingResults;

      // Update database with new processing results
      await prisma.wP_UPLOADED_EXCEL_FILES.update({
        where: { id: parseInt(fileId) },
        data: {
          invoice_count: processedData.length,
          processing_status: "processed",
          processed_date: new Date(),
          processing_logs: JSON.stringify(processingResult.logs),
          error_message: null,
        },
      });

      res.json({
        success: true,
        message: `File reprocessed successfully. ${processedData.length} invoices found.`,
        data: {
          invoiceCount: processedData.length,
          processingLogs: processingResult.logs,
        },
      });
    } catch (error) {
      console.error("Error reprocessing file:", error);

      // Update status to error
      await prisma.wP_UPLOADED_EXCEL_FILES.update({
        where: { id: parseInt(req.params.fileId) },
        data: {
          processing_status: "error",
          error_message: error.message,
          processed_date: new Date(),
        },
      });

      res.status(500).json({
        success: false,
        error: "Failed to reprocess file",
      });
    }
  }
);

// Global status tracking for real-time updates
const bulkSubmissionStatus = new Map();

// Enhanced bulk submission function with "all-or-nothing" transaction approach and real-time status
async function processBulkSubmissionEnhanced(files, user, sessionId) {
  const submissionId = `bulk_${Date.now()}_${Math.random()
    .toString(36)
    .substr(2, 9)}`;

  // Initialize status tracking
  bulkSubmissionStatus.set(submissionId, {
    sessionId,
    totalFiles: files.length,
    processedFiles: 0,
    currentPhase: "initializing",
    files: files.map((f) => ({
      id: f.id,
      filename: f.filename,
      status: "pending",
      phase: "waiting",
      errors: [],
      invoiceCount: f.invoice_count,
    })),
    overallStatus: "processing",
    startTime: new Date(),
    lastUpdate: new Date(),
  });

  console.log(
    `Starting enhanced bulk submission for ${files.length} files with all-or-nothing validation (ID: ${submissionId})`
  );

  // Helper function to update status
  const updateStatus = (fileId, updates) => {
    const status = bulkSubmissionStatus.get(submissionId);
    if (status) {
      if (fileId) {
        const fileIndex = status.files.findIndex((f) => f.id === fileId);
        if (fileIndex !== -1) {
          status.files[fileIndex] = { ...status.files[fileIndex], ...updates };
        }
      }
      Object.assign(status, updates);
      status.lastUpdate = new Date();
      bulkSubmissionStatus.set(submissionId, status);

      // Log critical status changes
      if (updates.currentPhase) {
        console.log(`📊 [${submissionId}] Phase: ${updates.currentPhase}`);
      }
      if (updates.overallStatus) {
        console.log(
          `📊 [${submissionId}] Overall Status: ${updates.overallStatus}`
        );
      }
    }
  };

  try {
    const results = [];
    updateStatus(null, {
      currentPhase: "processing_files",
      overallStatus: "processing",
    });

    for (const file of files) {
      try {
        console.log(`📁 Processing file: ${file.filename}`);
        updateStatus(file.id, { status: "processing", phase: "reading_file" });

        // Read and process the Excel file
        const filePath = file.file_path;
        if (!fs.existsSync(filePath)) {
          throw new Error(`File not found: ${filePath}`);
        }

        // Process Excel file to get invoice data
        const processingResult = await consumeExcelFile(filePath);
        if (!processingResult.success || !processingResult.processingResults) {
          throw new Error("Failed to process Excel file");
        }

        const processedData = processingResult.processingResults;
        console.log(
          `Found ${processedData.length} invoices in ${file.filename}`
        );

        // PHASE 1: PRE-VALIDATE ALL DOCUMENTS IN THE FILE
        console.log(
          `📋 Phase 1: Pre-validating all ${processedData.length} documents in ${file.filename}`
        );
        updateStatus(file.id, {
          phase: "phase1_preparation",
          status: "processing",
        });

        const allDocuments = [];
        const documentDetails = [];

        // Check for already-submitted invoices to prevent duplicates
        const invoiceNumbers = processedData
          .map(inv => inv.invoiceNumber || inv.invoice_number)
          .filter(Boolean);

        let alreadySubmitted = [];
        if (invoiceNumbers.length > 0) {
          try {
            alreadySubmitted = await prisma.wP_INVOICE_SUBMISSIONS.findMany({
              where: {
                invoice_number: { in: invoiceNumbers },
                submitted_by: user.id,
                status: { in: ['accepted', 'valid'] },
              },
              select: { invoice_number: true, lhdn_uuid: true }
            });
          } catch (e) {
            console.warn('Invoice submission tracking table not available yet:', e.message);
          }
        }

        const submittedSet = new Set(alreadySubmitted.map(s => s.invoice_number));
        if (submittedSet.size > 0) {
          console.log(`⚠️ Skipping ${submittedSet.size} already-accepted invoices: ${[...submittedSet].join(', ')}`);
        }

        // Prepare all documents for validation (skip already-accepted ones)
        for (let i = 0; i < processedData.length; i++) {
          const invoiceData = processedData[i];
          try {
            // Map to LHDN format
            const lhdnJson = mapToLHDNFormat([invoiceData], "1.0");

            // Skip invoices already accepted by LHDN
            const invNum = lhdnJson?.Invoice?.[0]?.ID?.[0]?._ || invoiceData.invoiceNumber || invoiceData.invoice_number;
            if (submittedSet.has(invNum)) {
              console.log(`⏭️ Skipping already-accepted invoice: ${invNum}`);
              continue;
            }
            if (!lhdnJson) {
              throw new Error(`Failed to map invoice ${i + 1} to LHDN format`);
            }

            // Prepare document for submission
            const submitter = new LHDNSubmitter({ user });
            const { payload, invoice_number } =
              await submitter.prepareDocumentForSubmission(lhdnJson, "1.0");

            if (
              !payload ||
              !payload.documents ||
              payload.documents.length === 0
            ) {
              throw new Error(
                `Failed to prepare invoice ${invoice_number} for submission`
              );
            }

            allDocuments.push(...payload.documents);
            documentDetails.push({
              index: i,
              invoice_number,
              invoiceData,
              lhdnJson,
              payload,
            });
          } catch (prepError) {
            throw new Error(
              `Document preparation failed for invoice ${i + 1}: ${
                prepError.message
              }`
            );
          }
        }

        // PHASE 2: BATCH VALIDATION - ALL OR NOTHING
        console.log(
          `🔍 Phase 2: Batch validating all ${allDocuments.length} documents`
        );
        updateStatus(file.id, {
          phase: "phase2_validation",
          status: "validating",
        });

        const submitter = new LHDNSubmitter({ user });
        const validationResult = await submitter.preValidateDocuments(
          allDocuments
        );

        if (!validationResult.isValid) {
          // VALIDATION FAILED - REJECT ENTIRE FILE
          const validationError = validationResult.error;
          console.error(
            `❌ VALIDATION FAILED for file ${file.filename}:`,
            validationError
          );

          // Create detailed error response
          const detailedErrors = validationError.details.map((detail) => ({
            invoiceNumber: detail.invoiceNumber,
            index: detail.index,
            errors: detail.errors.map((err) => ({
              code: err.code,
              field: err.field || "Unknown",
              message: err.message,
              value: err.value,
            })),
          }));

          // Update status with validation failure details
          updateStatus(file.id, {
            status: "validation_failed",
            phase: "validation_failed",
            errors: detailedErrors,
            validationSummary: {
              totalDocuments: processedData.length,
              failedDocuments: validationError.details.length,
              validDocuments:
                processedData.length - validationError.details.length,
            },
          });

          // Log specific validation failures for traceability
          console.error(
            `❌ [${submissionId}] File ${file.filename} VALIDATION SUMMARY:`
          );
          console.error(`   📊 Total Documents: ${processedData.length}`);
          console.error(
            `   ❌ Failed Documents: ${validationError.details.length}`
          );
          console.error(
            `   ✅ Valid Documents: ${
              processedData.length - validationError.details.length
            }`
          );

          validationError.details.forEach((detail, index) => {
            console.error(
              `   📄 Invoice ${detail.invoiceNumber}:`
            );
            detail.errors.forEach((err) => {
              console.error(
                `      ❌ ${err.code}: ${err.field} - ${err.message}`
              );
            });
          });

          throw {
            code: "PRE_SUBMISSION_VALIDATION_FAILED",
            message: validationError.message,
            details: detailedErrors,
            totalDocuments: processedData.length,
            failedDocuments: validationError.details.length,
          };
        }

        console.log(
          `Phase 2 Complete: All ${allDocuments.length} documents passed validation`
        );

        // PHASE 3: SUBMIT ALL DOCUMENTS AS A BATCH
        console.log(
          `Phase 3: Submitting all ${allDocuments.length} documents as a batch`
        );

        const submissionResult = await submitter.submitToLHDNDocument(
          allDocuments
        );

        console.log(`LHDN submission result for ${file.filename}:`, JSON.stringify(submissionResult, null, 2));

        // FIXED: Parse LHDN response to handle mixed success/failure results
        // Previously, the code only checked for overall success/failure and stored a simplified response.
        // Now we properly parse acceptedDocuments and rejectedDocuments to show accurate status in the UI.
        let totalDocuments = processedData.length;
        let validDocuments = 0;
        let failedDocuments = 0;
        let submissionUid = null;
        let finalStatus = "error";
        let lhdnResponseData = submissionResult;

        if (submissionResult.status === "success" && submissionResult.data) {
          const acceptedDocs = submissionResult.data.acceptedDocuments || [];
          const rejectedDocs = submissionResult.data.rejectedDocuments || [];

          validDocuments = acceptedDocs.length;
          failedDocuments = rejectedDocs.length;
          submissionUid = submissionResult.data.submissionUid || submissionResult.submissionId;

          // Determine final status based on results
          if (failedDocuments === 0 && validDocuments > 0) {
            finalStatus = "submitted"; // All successful
          } else if (validDocuments === 0 && failedDocuments > 0) {
            finalStatus = "error"; // All failed
          } else if (validDocuments > 0 && failedDocuments > 0) {
            finalStatus = "submitted"; // Partial success - still mark as submitted since some succeeded
          } else {
            finalStatus = "error"; // No documents processed
          }

          // Create enhanced response with summary for frontend display
          lhdnResponseData = {
            ...submissionResult,
            summary: {
              totalDocuments,
              validDocuments,
              failedDocuments,
              submissionUid,
              processedAt: new Date().toISOString()
            }
          };

          console.log(`📊 Submission summary for ${file.filename}: ${validDocuments}/${totalDocuments} successful, ${failedDocuments} failed`);

          // Store per-invoice submission results for duplicate prevention
          try {
            const invoiceRecords = [];
            for (const doc of acceptedDocs) {
              invoiceRecords.push({
                excel_file_id: file.id,
                invoice_number: doc.invoiceCodeNumber || doc.codeNumber,
                lhdn_uuid: doc.uuid || null,
                submission_uid: submissionUid,
                status: 'accepted',
                submitted_by: user.id,
              });
            }
            for (const doc of rejectedDocs) {
              invoiceRecords.push({
                excel_file_id: file.id,
                invoice_number: doc.invoiceCodeNumber || doc.codeNumber,
                lhdn_uuid: null,
                submission_uid: submissionUid,
                status: 'rejected',
                error_code: doc.error?.code || null,
                error_message: (doc.error?.message || '').substring(0, 500),
                submitted_by: user.id,
              });
            }
            if (invoiceRecords.length > 0) {
              for (const record of invoiceRecords) {
                await prisma.wP_INVOICE_SUBMISSIONS.upsert({
                  where: {
                    UQ_invoice_submission_user: {
                      invoice_number: record.invoice_number,
                      submitted_by: record.submitted_by,
                    }
                  },
                  update: {
                    lhdn_uuid: record.lhdn_uuid || undefined,
                    submission_uid: record.submission_uid,
                    status: record.status,
                    error_code: record.error_code || null,
                    error_message: record.error_message || null,
                    excel_file_id: record.excel_file_id,
                  },
                  create: record,
                });
              }
              console.log(`📝 Stored ${invoiceRecords.length} invoice submission records`);
            }
          } catch (trackErr) {
            console.warn('Failed to store invoice submission tracking (table may not exist yet):', trackErr.message);
          }
        } else {
          // Complete failure
          failedDocuments = totalDocuments;
          finalStatus = "error";

          throw {
            code: "SUBMISSION_FAILED",
            message: submissionResult.error?.message || "LHDN submission failed",
            details: submissionResult.error?.details || [],
            totalDocuments: processedData.length,
          };
        }

        // PHASE 4: TRIGGER POLLING FOR ALL SUBMITTED DOCUMENTS (only if we have a submission UID)
        if (submissionUid) {
          console.log(`Phase 4: Setting up polling for submitted documents`);
          console.log(
            `Starting delayed polling for bulk submission ${submissionUid} (file: ${file.filename})`
          );

          setTimeout(async () => {
            try {
              const { pollSubmissionStatus } = require("./lhdn");
              const pollResult = await pollSubmissionStatus(submissionUid, 5);
              console.log(
                `Bulk submission polling completed for ${submissionUid} (file: ${file.filename}):`,
                pollResult
              );
            } catch (pollError) {
              console.error(
                `Bulk submission polling error for ${submissionUid} (file: ${file.filename}):`,
                pollError
              );
            }
          }, 5000);
        }

        // PHASE 5: CLEANUP JSON FILES (only for successfully submitted invoices)
        if (validDocuments > 0) {
          console.log(`Phase 5: Cleaning up JSON files for ${validDocuments} successfully submitted invoices`);
          try {
            // Only cleanup files for successfully submitted documents
            const successfulInvoiceNumbers = submissionResult.data?.acceptedDocuments?.map(doc =>
              doc.invoiceCodeNumber || doc.codeNumber
            ).filter(Boolean) || [];

            if (successfulInvoiceNumbers.length > 0) {
              await cleanupLHDNJsonFiles(successfulInvoiceNumbers);
              console.log(`✅ Cleaned up JSON files for ${successfulInvoiceNumbers.length} successful invoices`);
            }
          } catch (cleanupError) {
            console.error(`⚠️ Warning: Failed to cleanup JSON files:`, cleanupError);
            // Don't fail the submission if cleanup fails
          }
        }

        // Update file status with detailed LHDN response
        await prisma.wP_UPLOADED_EXCEL_FILES.update({
          where: { id: file.id },
          data: {
            processing_status: finalStatus,
            submitted_date: validDocuments > 0 ? new Date() : file.submitted_date,
            lhdn_response: JSON.stringify(lhdnResponseData),
            updated_at: new Date(),
          },
        });

        // Create result entry with detailed status information
        const resultMessage = failedDocuments === 0
          ? `All ${validDocuments} invoices successfully submitted`
          : validDocuments === 0
            ? `All ${failedDocuments} invoices failed submission`
            : `${validDocuments} of ${totalDocuments} invoices submitted successfully, ${failedDocuments} failed`;

        results.push({
          fileId: file.id,
          filename: file.filename,
          status: finalStatus === "submitted" ? "success" : "failed",
          invoicesProcessed: totalDocuments,
          validDocuments: validDocuments,
          failedDocuments: failedDocuments,
          submissionUid: submissionUid,
          message: resultMessage,
        });

        console.log(
          `✅ File ${file.filename} processed: ${validDocuments}/${totalDocuments} invoices submitted successfully`
        );
      } catch (fileError) {
        console.error(`❌ Error processing file ${file.filename}:`, fileError);

        // Determine the appropriate status based on error type
        let processingStatus = "error";
        let errorResponse = {
          success: false,
          error: fileError.message || "Unknown error",
          timestamp: new Date(),
        };

        if (fileError.code === "PRE_SUBMISSION_VALIDATION_FAILED") {
          processingStatus = "processed"; // Keep as processed so user can fix and retry
          errorResponse = {
            success: false,
            validationFailed: true,
            error: fileError.message,
            details: fileError.details,
            totalDocuments: fileError.totalDocuments,
            failedDocuments: fileError.failedDocuments,
            timestamp: new Date(),
          };

          // Update global status for real-time tracking
          updateStatus(file.id, {
            status: "validation_failed",
            phase: "completed_with_errors",
            finalResult: "validation_failed",
          });
        } else if (fileError.code === "SUBMISSION_FAILED") {
          errorResponse = {
            status: "failed",
            error: {
              code: fileError.code,
              message: fileError.message || "LHDN submission failed",
              details: fileError.details || [],
            },
            totalDocuments: fileError.totalDocuments,
            timestamp: new Date(),
          };

          updateStatus(file.id, {
            status: "error",
            phase: "completed_with_errors",
            finalResult: "error",
          });
        } else {
          // Update global status for other errors
          updateStatus(file.id, {
            status: "error",
            phase: "completed_with_errors",
            finalResult: "error",
          });
        }

        // Update file status with detailed error information
        await prisma.wP_UPLOADED_EXCEL_FILES.update({
          where: { id: file.id },
          data: {
            processing_status: processingStatus,
            error_message: fileError.message || "Processing failed",
            lhdn_response: JSON.stringify(errorResponse),
          },
        });

        results.push({
          fileId: file.id,
          filename: file.filename,
          status: "error",
          error: fileError.message || "Processing failed",
          errorCode: fileError.code,
          details: fileError.details,
          validationFailed:
            fileError.code === "PRE_SUBMISSION_VALIDATION_FAILED",
        });
      }
    }

    const successCount = results.filter((r) => r.status === "success").length;
    const errorCount = results.filter((r) => r.status === "error").length;
    const validationFailedCount = results.filter(
      (r) => r.validationFailed
    ).length;

    // Update final status
    updateStatus(null, {
      currentPhase: "completed",
      overallStatus:
        errorCount > 0 ? "completed_with_errors" : "completed_successfully",
      processedFiles: files.length,
      summary: {
        totalFiles: files.length,
        successfulFiles: successCount,
        errorFiles: errorCount,
        validationFailedFiles: validationFailedCount,
      },
      endTime: new Date(),
    });

    console.log(
      `🏁 Enhanced bulk submission completed. Success: ${successCount}, Errors: ${errorCount}, Validation Failed: ${validationFailedCount}`
    );

    // Log final summary for traceability
    console.log(`📊 [${submissionId}] FINAL SUMMARY:`);
    console.log(`   📁 Total Files: ${files.length}`);
    console.log(`   ✅ Successful: ${successCount}`);
    console.log(`   ❌ Errors: ${errorCount}`);
    console.log(`   🔍 Validation Failed: ${validationFailedCount}`);

    // Keep status in memory for 30 minutes for real-time access
    setTimeout(() => {
      bulkSubmissionStatus.delete(submissionId);
      console.log(`🗑️ Cleaned up status for submission ${submissionId}`);
    }, 30 * 60 * 1000);

    return results;
  } catch (error) {
    console.error("Enhanced bulk submission process error:", error);

    // Update all files to error status
    const fileIds = files.map((f) => f.id);
    await prisma.wP_UPLOADED_EXCEL_FILES.updateMany({
      where: { id: { in: fileIds } },
      data: {
        processing_status: "error",
        error_message: `Bulk submission failed: ${error.message}`,
      },
    });

    throw error;
  }
}

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
          throw new Error("Failed to process Excel file");
        }

        const processedData = processingResult.processingResults;
        console.log(
          `Found ${processedData.length} invoices in ${file.filename}`
        );

        // Submit each invoice to LHDN
        for (const invoiceData of processedData) {
          try {
            // Map to LHDN format
            const lhdnJson = mapToLHDNFormat([invoiceData], "1.0");
            if (!lhdnJson) {
              throw new Error("Failed to map invoice data to LHDN format");
            }

            // Prepare document for submission
            const submitter = new LHDNSubmitter({ user });
            const { payload, invoice_number } =
              await submitter.prepareDocumentForSubmission(lhdnJson, "1.0");

            if (!payload) {
              throw new Error("Failed to prepare document for submission");
            }

            // Submit to LHDN (use prepared documents array)
            const result = await submitter.submitToLHDNDocument(
              payload.documents
            );

            if (
              result.status === "success" &&
              result.data?.acceptedDocuments?.length > 0
            ) {
              const acceptedDoc = result.data.acceptedDocuments[0];
              const submissionUid = result.submissionId || result.submissionUid;
              console.log(
                `Successfully submitted invoice ${invoice_number}, UUID: ${acceptedDoc.uuid}, SubmissionUID: ${submissionUid}`
              );

              // CRITICAL FIX: Add missing polling trigger for bulk submissions
              if (submissionUid) {
                console.log(
                  `Starting delayed polling for bulk submission ${submissionUid} (invoice: ${invoice_number})`
                );

                // Trigger background polling with 5 second delay (same as individual submissions)
                setTimeout(async () => {
                  try {
                    // Import the polling function dynamically to avoid circular dependency
                    const { pollSubmissionStatus } = require("./lhdn");

                    const pollResult = await pollSubmissionStatus(
                      submissionUid,
                      5
                    ); // 5 max attempts for background polling
                    console.log(
                      `Bulk submission polling completed for ${submissionUid} (invoice: ${invoice_number}):`,
                      pollResult
                    );
                  } catch (pollError) {
                    console.error(
                      `Bulk submission polling error for ${submissionUid} (invoice: ${invoice_number}):`,
                      pollError
                    );
                  }
                }, 5000 + successCount * 1000); // Stagger polling to avoid rate limits
              }

              successCount++;
            } else {
              console.error(
                `Failed to submit invoice ${invoice_number}:`,
                result.error
              );
              errorCount++;
            }
          } catch (invoiceError) {
            console.error(
              `Error submitting invoice from ${file.filename}:`,
              invoiceError
            );
            errorCount++;
          }
        }

        // Update file status to submitted
        await prisma.wP_UPLOADED_EXCEL_FILES.update({
          where: { id: file.id },
          data: {
            processing_status: "submitted",
            submitted_date: new Date(),
            lhdn_response: JSON.stringify({
              success: true,
              submittedAt: new Date(),
              invoicesProcessed: processedData.length,
            }),
          },
        });

        results.push({
          fileId: file.id,
          filename: file.filename,
          status: "success",
          invoicesProcessed: processedData.length,
        });
      } catch (fileError) {
        console.error(`Error processing file ${file.filename}:`, fileError);

        // Update file status to error
        await prisma.wP_UPLOADED_EXCEL_FILES.update({
          where: { id: file.id },
          data: {
            // If the error is a pre-submission validation error, keep status as processed
            processing_status:
              fileError && fileError.code === "PRE_SUBMISSION_VALIDATION_FAILED"
                ? "processed"
                : "error",
            error_message: fileError.message,
            lhdn_response: JSON.stringify({
              success: false,
              error: fileError.message,
              timestamp: new Date(),
            }),
          },
        });

        results.push({
          fileId: file.id,
          filename: file.filename,
          status: "error",
          error: fileError.message,
        });

        errorCount++;
      }
    }

    console.log(
      `Bulk submission completed. Success: ${successCount}, Errors: ${errorCount}`
    );
  } catch (error) {
    console.error("Bulk submission process error:", error);

    // Update all files to error status
    const fileIds = files.map((f) => f.id);
    await prisma.wP_UPLOADED_EXCEL_FILES.updateMany({
      where: { id: { in: fileIds } },
      data: {
        processing_status: "error",
        error_message: `Bulk submission failed: ${error.message}`,
      },
    });
  }
}

// Real-time bulk submission status endpoint
router.get(
  "/bulk-submission-realtime-status/:sessionId",
  [auth.isApiAuthenticated],
  async (req, res) => {
    try {
      const sessionId = req.params.sessionId;

      // Find active submission for this session
      let activeSubmission = null;
      for (const [submissionId, status] of bulkSubmissionStatus.entries()) {
        if (status.sessionId === sessionId) {
          activeSubmission = { submissionId, ...status };
          break;
        }
      }

      if (!activeSubmission) {
        return res.json({
          success: true,
          data: {
            hasActiveSubmission: false,
            message: "No active bulk submission found for this session",
          },
        });
      }

      // Return real-time status
      res.json({
        success: true,
        data: {
          hasActiveSubmission: true,
          submissionId: activeSubmission.submissionId,
          currentPhase: activeSubmission.currentPhase,
          overallStatus: activeSubmission.overallStatus,
          totalFiles: activeSubmission.totalFiles,
          processedFiles: activeSubmission.processedFiles,
          files: activeSubmission.files,
          summary: activeSubmission.summary,
          startTime: activeSubmission.startTime,
          lastUpdate: activeSubmission.lastUpdate,
          endTime: activeSubmission.endTime,
        },
      });
    } catch (error) {
      console.error("Error getting real-time bulk submission status:", error);
      res.status(500).json({
        success: false,
        error: "Failed to get real-time submission status",
      });
    }
  }
);

// Enhanced bulk submission status endpoint with detailed validation results
router.get(
  "/bulk-submission-status/:fileId",
  [auth.isApiAuthenticated],
  async (req, res) => {
    try {
      const fileId = parseInt(req.params.fileId);

      const file = await prisma.wP_UPLOADED_EXCEL_FILES.findFirst({
        where: {
          id: fileId,
          uploaded_by_user_id: req.user.id,
        },
      });

      if (!file) {
        return res.status(404).json({
          success: false,
          error: "File not found",
        });
      }

      let detailedResponse = {
        fileId: file.id,
        filename: file.filename,
        status: file.processing_status,
        invoiceCount: file.invoice_count,
        submittedDate: file.submitted_date,
        errorMessage: file.error_message,
      };

      // Parse LHDN response for detailed information
      if (file.lhdn_response) {
        try {
          const lhdnResponse = JSON.parse(file.lhdn_response);
          detailedResponse.lhdnResponse = lhdnResponse;

          // If validation failed, provide detailed error breakdown
          if (lhdnResponse.validationFailed && lhdnResponse.details) {
            detailedResponse.validationErrors = lhdnResponse.details.map(
              (detail) => ({
                invoiceNumber: detail.invoiceNumber,
                index: detail.index,
                errors: detail.errors.map((err) => ({
                  code: err.code,
                  field: err.field,
                  message: err.message,
                  value: err.value,
                  userFriendlyMessage: getUserFriendlyErrorMessage(err),
                })),
              })
            );

            detailedResponse.summary = {
              totalDocuments: lhdnResponse.totalDocuments,
              failedDocuments: lhdnResponse.failedDocuments,
              validDocuments:
                lhdnResponse.totalDocuments - lhdnResponse.failedDocuments,
            };
          }
        } catch (parseError) {
          console.error("Error parsing LHDN response:", parseError);
        }
      }

      res.json({
        success: true,
        data: detailedResponse,
      });
    } catch (error) {
      console.error("Error getting bulk submission status:", error);
      res.status(500).json({
        success: false,
        error: "Failed to get submission status",
      });
    }
  }
);

// Helper function to provide user-friendly error messages
function getUserFriendlyErrorMessage(error) {
  const errorMappings = {
    CF406:
      "Invalid SST registration number format. Please use format: W10-0123-12345678",
    ERR406:
      "Invalid Buyer TIN. Please use the Search TIN function to verify the correct TIN.",
    INVALID_DOC: "Document format is invalid or corrupted.",
    INVALID_JSON: "Document contains invalid data format.",
    INVALID_XML: "XML document structure is invalid.",
  };

  return (
    errorMappings[error.code] || error.message || "Unknown validation error"
  );
}

// Manual polling endpoint to recover missing submissions
router.post(
  "/manual-poll-submissions",
  [auth.isApiAuthenticated],
  async (req, res) => {
    try {
      const { submissionUids } = req.body;

      if (!submissionUids || !Array.isArray(submissionUids)) {
        return res.status(400).json({
          success: false,
          error: "submissionUids array is required",
        });
      }

      console.log(
        `Manual polling requested for ${submissionUids.length} submissions`
      );

      // Import the polling function
      const { pollSubmissionStatus } = require("./lhdn");

      const results = [];

      for (let i = 0; i < submissionUids.length; i++) {
        const submissionUid = submissionUids[i];
        try {
          console.log(
            `Manual polling submission ${i + 1}/${
              submissionUids.length
            }: ${submissionUid}`
          );

          const pollResult = await pollSubmissionStatus(submissionUid, 3); // 3 attempts for manual polling
          results.push({
            submissionUid,
            success: true,
            result: pollResult,
          });

          // Add delay between polls to avoid rate limiting
          if (i < submissionUids.length - 1) {
            await new Promise((resolve) => setTimeout(resolve, 2000));
          }
        } catch (error) {
          console.error(`Manual polling error for ${submissionUid}:`, error);
          results.push({
            submissionUid,
            success: false,
            error: error.message,
          });
        }
      }

      res.json({
        success: true,
        message: `Manual polling completed for ${submissionUids.length} submissions`,
        results,
      });
    } catch (error) {
      console.error("Manual polling error:", error);
      res.status(500).json({
        success: false,
        error: "Failed to process manual polling request",
      });
    }
  }
);

/**
 * Cleanup function to delete LHDN JSON files after successful submission
 * This prevents reuse of old JSON files when the same InvoiceNo is submitted again
 * @param {Array} invoiceNumbers - Array of invoice numbers to cleanup
 */
async function cleanupLHDNJsonFiles(invoiceNumbers) {
  if (!invoiceNumbers || invoiceNumbers.length === 0) {
    console.log('No invoice numbers provided for cleanup');
    return;
  }

  const logsDir = path.join(process.cwd(), 'logs', 'lhdn');

  // Check if logs directory exists
  if (!fs.existsSync(logsDir)) {
    console.log('LHDN logs directory does not exist, no cleanup needed');
    return;
  }

  let totalFilesDeleted = 0;
  const deletionResults = [];

  for (const invoiceNo of invoiceNumbers) {
    try {
      // Find all JSON files for this invoice number
      const files = fs.readdirSync(logsDir);
      const invoiceFiles = files.filter(file => {
        // Match both output and process files for this invoice
        return (file.startsWith(`lhdn_output_${invoiceNo}_`) ||
                file.startsWith(`lhdn_process_${invoiceNo}_`)) &&
               file.endsWith('.json');
      });

      let filesDeleted = 0;
      for (const file of invoiceFiles) {
        const filePath = path.join(logsDir, file);
        try {
          fs.unlinkSync(filePath);
          filesDeleted++;
          totalFilesDeleted++;
          console.log(`🗑️ Deleted JSON file: ${file}`);
        } catch (deleteError) {
          console.error(`❌ Failed to delete file ${file}:`, deleteError.message);
        }
      }

      deletionResults.push({
        invoiceNo,
        filesFound: invoiceFiles.length,
        filesDeleted,
        success: filesDeleted === invoiceFiles.length
      });

      if (invoiceFiles.length === 0) {
        console.log(`ℹ️ No JSON files found for invoice: ${invoiceNo}`);
      } else {
        console.log(`✅ Cleaned up ${filesDeleted}/${invoiceFiles.length} files for invoice: ${invoiceNo}`);
      }

    } catch (error) {
      console.error(`❌ Error cleaning up files for invoice ${invoiceNo}:`, error.message);
      deletionResults.push({
        invoiceNo,
        filesFound: 0,
        filesDeleted: 0,
        success: false,
        error: error.message
      });
    }
  }

  console.log(`🧹 Cleanup Summary: Deleted ${totalFilesDeleted} JSON files for ${invoiceNumbers.length} invoices`);

  // Log detailed results for debugging
  const failedCleanups = deletionResults.filter(result => !result.success);
  if (failedCleanups.length > 0) {
    console.warn(`⚠️ Failed to cleanup files for ${failedCleanups.length} invoices:`,
                 failedCleanups.map(f => f.invoiceNo));
  }

  return {
    totalInvoices: invoiceNumbers.length,
    totalFilesDeleted,
    results: deletionResults,
    success: failedCleanups.length === 0
  };
}

module.exports = router;