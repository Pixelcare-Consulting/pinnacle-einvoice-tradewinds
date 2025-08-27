/**
 * Excel Consumer Service
 * Consumes Excel files using the updated processManualUploadExcelData.js
 * Generates comprehensive logs including process, raw data, and simplified versions
 */

const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const { validateExcelFilename } = require('../helpers/filenameValidator');
const { processManualUploadExcelData } = require('../lhdn/processManualUploadExcelData');
const { processMultipleInvoices } = require('./multiInvoiceProcessor');

/**
 * Main function to consume and process Excel files
 * @param {string} filePath - Path to the Excel file
 * @param {Object} options - Processing options
 * @returns {Object} Processing results with logs
 */
const consumeExcelFile = async (filePath, options = {}) => {
  const startTime = new Date();
  const timestamp = startTime.toISOString().replace(/[:.]/g, '-');
  
  const result = {
    success: false,
    filename: null,
    filenameValidation: null,
    processingResults: null,
    logs: {
      process: null,
      rawData: null,
      simplified: null,
      untouched: null
    },
    error: null,
    processingTime: null,
    timestamp: timestamp
  };

  try {
    // Use original filename if provided, otherwise extract from path
    const filename = options.originalFilename || path.basename(filePath);
    result.filename = filename;

    console.log(`[Excel Consumer] Starting processing of: ${filename} (file path: ${filePath})`);

    // Step 1: Validate filename format using the original filename
    console.log(`[Excel Consumer] Validating filename format...`);
    const filenameValidation = validateExcelFilename(filename);
    result.filenameValidation = filenameValidation;

    if (!filenameValidation.isValid) {
      throw new Error(`Invalid filename format: ${filenameValidation.error}`);
    }

    console.log(`[Excel Consumer] Filename validation passed:`, {
      date: filenameValidation.parsedData.formattedDate,
      time: filenameValidation.parsedData.formattedTime
    });

    // Step 2: Check if file exists
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    // Step 3: Read Excel file
    console.log(`[Excel Consumer] Reading Excel file...`);
    const workbook = XLSX.readFile(filePath);
    const worksheet = workbook.Sheets[workbook.SheetNames[0]];
    const rawData = XLSX.utils.sheet_to_json(worksheet, {
      raw: true,
      defval: null,
      blankrows: false
    });

    console.log(`[Excel Consumer] Excel file read successfully. Rows: ${rawData.length}`);

    // Step 4: Create untouched log (original Excel data)
    const untouchedLog = {
      timestamp: startTime.toISOString(),
      filename: filename,
      filenameValidation: filenameValidation,
      totalRows: rawData.length,
      structure: 'UNTOUCHED_EXCEL_DATA',
      data: rawData
    };

    // Step 5: Process Excel data using enhanced multi-invoice processor
    console.log(`[Excel Consumer] Processing Excel data with enhanced multi-invoice processor...`);

    // Use enhanced multi-invoice processor if enabled
    if (options.useEnhancedProcessor !== false) {
      const enhancedResults = processMultipleInvoices(rawData, options);
      result.processingResults = enhancedResults.invoices;
      result.enhancedResults = enhancedResults;

      console.log(`[Excel Consumer] Enhanced processing completed. Documents: ${enhancedResults.processedInvoices}/${enhancedResults.totalInvoices}`);
      console.log(`[Excel Consumer] Batch Summary - Total Amount: ${enhancedResults.batchSummary.totalAmount}, Currencies: ${enhancedResults.batchSummary.currencies.join(', ')}`);

      if (enhancedResults.validation.duplicateInvoices.length > 0) {
        console.log(`[Excel Consumer] WARNING: Duplicate invoices detected: ${enhancedResults.validation.duplicateInvoices.join(', ')}`);
      }
    } else {
      // Fallback to original processor
      const processingResults = processManualUploadExcelData(rawData);
      result.processingResults = processingResults;
      console.log(`[Excel Consumer] Standard processing completed. Documents: ${processingResults.length}`);
    }

    // Step 6: Generate logs
    await generateComprehensiveLogs(result, untouchedLog, rawData, result.processingResults, timestamp);

    result.success = true;
    result.processingTime = new Date() - startTime;

    console.log(`[Excel Consumer] Processing completed successfully in ${result.processingTime}ms`);

  } catch (error) {
    result.error = {
      message: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
    };
    result.processingTime = new Date() - startTime;

    console.error(`[Excel Consumer] Processing failed:`, error.message);

    // Still try to generate error logs
    try {
      await generateErrorLogs(result, timestamp);
    } catch (logError) {
      console.error(`[Excel Consumer] Failed to generate error logs:`, logError.message);
    }
  }

  return result;
};

/**
 * Generates comprehensive logs for successful processing
 */
const generateComprehensiveLogs = async (result, untouchedLog, rawData, processingResults, timestamp) => {
  const logsDir = path.join(process.cwd(), 'logs', 'excel-consumer');
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }

  const baseFilename = result.filename.replace('.xlsx', '');

  // 1. Untouched Log (Original Excel Data)
  const untouchedPath = path.join(logsDir, `${baseFilename}_untouched_${timestamp}.json`);
  fs.writeFileSync(untouchedPath, JSON.stringify(untouchedLog, null, 2));
  result.logs.untouched = untouchedPath;
  console.log(`[Excel Consumer] Untouched log saved: ${untouchedPath}`);

  // 2. Raw Data Log (Structure Analysis)
  const rawDataLog = {
    timestamp: new Date().toISOString(),
    filename: result.filename,
    structure: 'RAW_DATA_ANALYSIS',
    columnHeaders: rawData[0] || {},
    fieldMappings: rawData[1] || {},
    dataRows: rawData.slice(2),
    analysis: {
      totalRows: rawData.length,
      headerRows: 2,
      dataRows: Math.max(0, rawData.length - 2),
      invoiceRows: rawData.slice(2).filter(row => {
        if (!row || !row.Invoice) return false;

        const invoiceValue = row.Invoice.toString().trim();

        // Check if it's a valid invoice number (numeric or alphanumeric invoice ID)
        // Skip header rows like "Invoice", "Internal Document Reference Number", "Invoice_ID"
        if (invoiceValue &&
            invoiceValue !== 'Invoice' &&
            invoiceValue !== 'Internal Document Reference Number' &&
            invoiceValue !== 'Invoice_ID' &&
            invoiceValue.length > 0) {

          // Additional validation: check if it looks like an invoice number
          // (contains numbers or is a proper invoice format)
          if (/\d/.test(invoiceValue) || /^[A-Z0-9]+$/i.test(invoiceValue)) {
            return true;
          }
        }

        return false;
      }).length
    }
  };

  const rawDataPath = path.join(logsDir, `${baseFilename}_rawdata_${timestamp}.json`);
  fs.writeFileSync(rawDataPath, JSON.stringify(rawDataLog, null, 2));
  result.logs.rawData = rawDataPath;
  console.log(`[Excel Consumer] Raw data log saved: ${rawDataPath}`);

  // 3. Process Log (Processing Steps and Results)
  const processLog = {
    timestamp: new Date().toISOString(),
    filename: result.filename,
    structure: 'PROCESS_LOG',
    filenameValidation: result.filenameValidation,
    processingResults: {
      documentsProcessed: processingResults.length,
      documents: processingResults.map(doc => ({
        invoiceNo: doc.header?.invoiceNo,
        hasHeader: !!doc.header,
        hasSupplier: !!doc.supplier,
        hasBuyer: !!doc.buyer,
        hasDelivery: !!doc.delivery,
        hasItems: !!(doc.items && doc.items.length > 0),
        hasSummary: !!doc.summary,
        hasPayment: !!doc.payment,
        itemCount: doc.items ? doc.items.length : 0
      }))
    },
    processingTime: result.processingTime
  };

  const processPath = path.join(logsDir, `${baseFilename}_process_${timestamp}.json`);
  fs.writeFileSync(processPath, JSON.stringify(processLog, null, 2));
  result.logs.process = processPath;
  console.log(`[Excel Consumer] Process log saved: ${processPath}`);

  // 4. Simplified Log (Clean Summary)
  const simplifiedLog = {
    timestamp: new Date().toISOString(),
    filename: result.filename,
    structure: 'SIMPLIFIED_SUMMARY',
    summary: {
      fileInfo: {
        filename: result.filename,
        parsedDate: result.filenameValidation.parsedData.formattedDate,
        parsedTime: result.filenameValidation.parsedData.formattedTime
      },
      processing: {
        success: result.success,
        documentsFound: processingResults.length,
        processingTimeMs: result.processingTime
      },
      invoices: processingResults.map(doc => ({
        invoiceNumber: doc.header?.invoiceNo,
        supplier: {
          company: doc.supplier?.name,
          companyId: doc.supplier?.id,
          industry: doc.supplier?.industryClassificationCode,
          industryName: doc.supplier?.industryName,
          identifications: doc.supplier?.identifications || [],
          address: {
            line: doc.supplier?.address?.line,
            city: doc.supplier?.address?.city,
            state: doc.supplier?.address?.state,
            postcode: doc.supplier?.address?.postcode,
            country: doc.supplier?.address?.country
          },
          contact: {
            phone: doc.supplier?.contact?.phone,
            email: doc.supplier?.contact?.email
          }
        },
        buyer: {
          company: doc.buyer?.name,
          companyId: doc.buyer?.id,
          identifications: doc.buyer?.identifications || [],
          address: {
            line: doc.buyer?.address?.line,
            city: doc.buyer?.address?.city,
            state: doc.buyer?.address?.state,
            postcode: doc.buyer?.address?.postcode,
            country: doc.buyer?.address?.country
          },
          contact: {
            phone: doc.buyer?.contact?.phone,
            email: doc.buyer?.contact?.email
          }
        },
        currency: doc.header?.currency,
        totalAmount: doc.summary?.amounts?.payableAmount || 0,
        itemCount: doc.items ? doc.items.length : 0
      }))
    }
  };

  const simplifiedPath = path.join(logsDir, `${baseFilename}_simplified_${timestamp}.json`);
  fs.writeFileSync(simplifiedPath, JSON.stringify(simplifiedLog, null, 2));
  result.logs.simplified = simplifiedPath;
  console.log(`[Excel Consumer] Simplified log saved: ${simplifiedPath}`);
};

/**
 * Generates error logs for failed processing
 */
const generateErrorLogs = async (result, timestamp) => {
  const logsDir = path.join(process.cwd(), 'logs', 'excel-consumer', 'errors');
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }

  const baseFilename = result.filename ? result.filename.replace('.xlsx', '') : 'unknown';
  const errorLog = {
    timestamp: new Date().toISOString(),
    filename: result.filename,
    structure: 'ERROR_LOG',
    filenameValidation: result.filenameValidation,
    error: result.error,
    processingTime: result.processingTime
  };

  const errorPath = path.join(logsDir, `${baseFilename}_error_${timestamp}.json`);
  fs.writeFileSync(errorPath, JSON.stringify(errorLog, null, 2));
  console.log(`[Excel Consumer] Error log saved: ${errorPath}`);
};

/**
 * Preview Excel file data without full processing
 * @param {string} filePath - Path to the Excel file
 * @param {Object} options - Preview options
 * @returns {Object} Preview results with sample data
 */
const previewExcelFile = async (filePath, options = {}) => {
  const startTime = new Date();
  const maxPreviewRows = options.maxRows || 15;

  const result = {
    success: false,
    filename: null,
    filenameValidation: null,
    preview: {
      headers: null,
      fieldMappings: null,
      sampleData: [],
      totalRows: 0,
      previewRows: 0
    },
    error: null,
    processingTime: null
  };

  try {
    // Use original filename if provided, otherwise extract from path
    const filename = options.originalFilename || path.basename(filePath);
    result.filename = filename;

    console.log(`[Excel Preview] Starting preview of: ${filename} (file path: ${filePath})`);

    // Step 1: Validate filename format using the original filename
    const filenameValidation = validateExcelFilename(filename);
    result.filenameValidation = filenameValidation;

    if (!filenameValidation.isValid) {
      throw new Error(`Invalid filename format: ${filenameValidation.error}`);
    }

    // Step 2: Check if file exists
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    // Step 3: Read Excel file
    console.log(`[Excel Preview] Reading Excel file...`);
    const workbook = XLSX.readFile(filePath);
    const worksheet = workbook.Sheets[workbook.SheetNames[0]];
    const rawData = XLSX.utils.sheet_to_json(worksheet, {
      raw: true,
      defval: null,
      blankrows: false
    });

    console.log(`[Excel Preview] Excel file read successfully. Total rows: ${rawData.length}`);

    // Step 4: Extract preview data
    result.preview.totalRows = rawData.length;

    if (rawData.length > 0) {
      // First row as headers
      result.preview.headers = rawData[0] || {};

      // Second row as field mappings (if exists)
      if (rawData.length > 1) {
        result.preview.fieldMappings = rawData[1] || {};
      }

      // Sample data rows (skip first 2 rows, take up to maxPreviewRows)
      const dataStartIndex = 2;
      const sampleData = rawData.slice(dataStartIndex, dataStartIndex + maxPreviewRows);
      result.preview.sampleData = sampleData;
      result.preview.previewRows = sampleData.length;
    }

    result.success = true;
    result.processingTime = new Date() - startTime;

    console.log(`[Excel Preview] Preview completed successfully in ${result.processingTime}ms`);

  } catch (error) {
    result.error = {
      message: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
    };
    result.processingTime = new Date() - startTime;

    console.error(`[Excel Preview] Preview failed:`, error.message);
  }

  return result;
};

module.exports = {
  consumeExcelFile,
  previewExcelFile
};
