/**
 * Enhanced Multi-Invoice Processor
 * Provides advanced dynamic processing for multiple invoices in Excel files
 */

const fs = require('fs');
const path = require('path');
const { processManualUploadExcelData } = require('../lhdn/processManualUploadExcelData');
const { validateExcelRows } = require('../lhdn/validateExcelRows');

/**
 * Enhanced multi-invoice processing with dynamic detection and batch operations
 * @param {Array} rawData - Raw Excel data
 * @param {Object} options - Processing options
 * @returns {Object} Enhanced processing results
 */
const processMultipleInvoices = (rawData, options = {}) => {
  const startTime = new Date();
  
  const result = {
    success: false,
    totalInvoices: 0,
    processedInvoices: 0,
    failedInvoices: 0,
    invoices: [],
    batchSummary: {
      totalAmount: 0,
      totalTaxAmount: 0,
      currencies: new Set(),
      invoiceTypes: new Set(),
      dateRange: { earliest: null, latest: null }
    },
    validation: {
      duplicateInvoices: [],
      invalidInvoices: [],
      warnings: []
    },
    processingTime: 0,
    logs: []
  };

  try {
    // Step 1: Validate the Excel structure
    const validation = validateExcelRows(rawData);
    result.validation.structureValidation = validation;

    // Step 2: Extract data rows (skip headers)
    const dataRows = rawData.slice(2); // Skip header rows
    
    // Step 3: Dynamic invoice detection
    const invoiceRows = detectInvoiceRows(dataRows);
    result.totalInvoices = invoiceRows.length;
    
    logStep(result, `Detected ${invoiceRows.length} invoices for processing`);

    // Step 4: Process each invoice
    const processedDocuments = processManualUploadExcelData(rawData);
    
    // Step 5: Enhanced processing with validation and analysis
    processedDocuments.forEach((doc, index) => {
      try {
        const enhancedInvoice = enhanceInvoiceData(doc, index);
        
        // Validate individual invoice
        const invoiceValidation = validateIndividualInvoice(enhancedInvoice);
        enhancedInvoice.validation = invoiceValidation;
        
        // Check for duplicates
        const isDuplicate = checkForDuplicate(enhancedInvoice, result.invoices);
        if (isDuplicate) {
          result.validation.duplicateInvoices.push(enhancedInvoice.header.invoiceNo);
          enhancedInvoice.validation.warnings.push('Duplicate invoice number detected');
        }
        
        // Update batch summary
        updateBatchSummary(result.batchSummary, enhancedInvoice);
        
        result.invoices.push(enhancedInvoice);
        result.processedInvoices++;
        
        logStep(result, `Processed invoice ${enhancedInvoice.header.invoiceNo} successfully`);
        
      } catch (error) {
        result.failedInvoices++;
        result.validation.invalidInvoices.push({
          index: index,
          invoiceNo: doc.header?.invoiceNo || 'Unknown',
          error: error.message
        });
        
        logStep(result, `Failed to process invoice at index ${index}: ${error.message}`, 'ERROR');
      }
    });

    // Step 6: Final validation and summary
    performBatchValidation(result);
    
    result.success = result.processedInvoices > 0;
    result.processingTime = new Date() - startTime;
    
    logStep(result, `Batch processing completed: ${result.processedInvoices}/${result.totalInvoices} invoices processed successfully`);
    
  } catch (error) {
    result.success = false;
    result.error = error.message;
    logStep(result, `Batch processing failed: ${error.message}`, 'ERROR');
  }

  return result;
};

/**
 * Detect invoice rows dynamically from data
 * @param {Array} dataRows - Data rows from Excel
 * @returns {Array} Array of invoice row objects
 */
const detectInvoiceRows = (dataRows) => {
  const invoiceRows = [];
  
  dataRows.forEach((row, index) => {
    if (row && row.Invoice) {
      const invoiceValue = String(row.Invoice).trim();
      
      // Enhanced invoice detection logic
      if (invoiceValue && 
          invoiceValue !== 'Invoice' && 
          invoiceValue !== 'Internal Document Reference Number' &&
          /\d/.test(invoiceValue)) { // Must contain at least one digit
        
        invoiceRows.push({
          rowIndex: index,
          invoiceNo: invoiceValue,
          rowData: row
        });
      }
    }
  });
  
  return invoiceRows;
};

/**
 * Enhance invoice data with additional metadata
 * @param {Object} invoice - Processed invoice document
 * @param {number} index - Invoice index
 * @returns {Object} Enhanced invoice data
 */
const enhanceInvoiceData = (invoice, index) => {
  // Ensure all mandatory fields are present
  const enhanced = {
    ...invoice,
    metadata: {
      processingIndex: index,
      processingTimestamp: new Date().toISOString(),
      documentId: `${invoice.header.invoiceNo}_${Date.now()}`,
      status: 'processed'
    },
    analytics: {
      lineItemCount: invoice.items ? invoice.items.length : 0,
      totalAmount: invoice.summary?.amounts?.payableAmount || 0,
      taxAmount: invoice.summary?.taxTotal?.taxAmount || 0,
      currency: invoice.header?.currency || 'MYR',
      invoiceType: invoice.header?.invoiceType || '01'
    }
  };

  // Fix shipment data mapping issues
  if (enhanced.delivery && enhanced.delivery.shipment) {
    // Ensure shipment data is properly structured
    enhanced.delivery.shipment = {
      id: enhanced.delivery.shipment.id || 'N/A',
      freightAllowanceCharge: {
        indicator: Boolean(enhanced.delivery.shipment.freightAllowanceCharge?.indicator),
        reason: enhanced.delivery.shipment.freightAllowanceCharge?.reason || 'N/A',
        amount: enhanced.delivery.shipment.freightAllowanceCharge?.amount || 0
      }
    };
  }

  // Ensure all required invoice fields are present
  if (!enhanced.header.invoiceDocumentReference) {
    enhanced.header.invoiceDocumentReference = enhanced.header.InvoiceDocumentReference_ID || '';
  }

  // Add missing mandatory fields that are expected in the full JSON format
  enhanced.invoiceDetails = {
    invoiceNumber: enhanced.header.invoiceNo,
    supplier: enhanced.supplier?.name || 'N/A',
    buyer: enhanced.buyer?.name || 'N/A',
    totalAmount: enhanced.analytics.totalAmount,
    taxAmount: enhanced.analytics.taxAmount,
    currency: enhanced.analytics.currency,
    invoiceType: enhanced.analytics.invoiceType,
    issueDate: enhanced.header.issueDate?.[0]?._ || new Date().toISOString().split('T')[0],
    lineItemCount: enhanced.analytics.lineItemCount
  };

  // Ensure delivery address is properly mapped
  if (enhanced.delivery && enhanced.delivery.address) {
    // Fix delivery address mapping issues
    const deliveryAddr = enhanced.delivery.address;
    enhanced.delivery.address = {
      line: deliveryAddr.line || 'N/A',
      city: deliveryAddr.city || 'N/A',
      postcode: deliveryAddr.postcode || 'N/A',
      state: deliveryAddr.state || 'N/A',
      country: deliveryAddr.country || 'MYS',
      countryListID: deliveryAddr.countryListID || 'ISO3166-1',
      countryListAgencyID: deliveryAddr.countryListAgencyID || '6'
    };
  }

  // Ensure payment information is complete
  if (enhanced.payment) {
    enhanced.payment = {
      ...enhanced.payment,
      paymentMeansCode: enhanced.payment.paymentMeansCode || '01',
      payeeFinancialAccount: enhanced.payment.payeeFinancialAccount || 'N/A',
      paymentTerms: enhanced.payment.paymentTerms || 'N/A'
    };
  }

  return enhanced;
};

/**
 * Validate individual invoice
 * @param {Object} invoice - Invoice to validate
 * @returns {Object} Validation results
 */
const validateIndividualInvoice = (invoice) => {
  const validation = {
    isValid: true,
    errors: [],
    warnings: []
  };
  
  // Required field validation
  if (!invoice.header?.invoiceNo) {
    validation.errors.push('Missing invoice number');
    validation.isValid = false;
  }
  
  if (!invoice.supplier?.name) {
    validation.errors.push('Missing supplier name');
    validation.isValid = false;
  }
  
  if (!invoice.buyer?.name) {
    validation.errors.push('Missing buyer name');
    validation.isValid = false;
  }
  
  // Amount validation
  const totalAmount = invoice.analytics?.totalAmount || 0;
  if (totalAmount <= 0) {
    validation.warnings.push('Invoice amount is zero or negative');
  }
  
  // Line items validation
  if (!invoice.items || invoice.items.length === 0) {
    validation.warnings.push('No line items found');
  }
  
  return validation;
};

/**
 * Check for duplicate invoices
 * @param {Object} invoice - Current invoice
 * @param {Array} existingInvoices - Previously processed invoices
 * @returns {boolean} True if duplicate found
 */
const checkForDuplicate = (invoice, existingInvoices) => {
  const currentInvoiceNo = invoice.header.invoiceNo;
  return existingInvoices.some(existing => 
    existing.header.invoiceNo === currentInvoiceNo
  );
};

/**
 * Update batch summary with invoice data
 * @param {Object} summary - Batch summary object
 * @param {Object} invoice - Invoice data
 */
const updateBatchSummary = (summary, invoice) => {
  const amount = invoice.analytics?.totalAmount || 0;
  const taxAmount = invoice.analytics?.taxAmount || 0;
  const currency = invoice.analytics?.currency || 'MYR';
  const invoiceType = invoice.analytics?.invoiceType || '01';
  
  summary.totalAmount += amount;
  summary.totalTaxAmount += taxAmount;
  summary.currencies.add(currency);
  summary.invoiceTypes.add(invoiceType);
  
  // Update date range (simplified - using processing date)
  const currentDate = new Date();
  if (!summary.dateRange.earliest || currentDate < summary.dateRange.earliest) {
    summary.dateRange.earliest = currentDate;
  }
  if (!summary.dateRange.latest || currentDate > summary.dateRange.latest) {
    summary.dateRange.latest = currentDate;
  }
};

/**
 * Perform batch-level validation
 * @param {Object} result - Processing result object
 */
const performBatchValidation = (result) => {
  // Convert Sets to Arrays for JSON serialization
  result.batchSummary.currencies = Array.from(result.batchSummary.currencies);
  result.batchSummary.invoiceTypes = Array.from(result.batchSummary.invoiceTypes);
  
  // Check for mixed currencies
  if (result.batchSummary.currencies.length > 1) {
    result.validation.warnings.push(`Mixed currencies detected: ${result.batchSummary.currencies.join(', ')}`);
  }
  
  // Check for mixed invoice types
  if (result.batchSummary.invoiceTypes.length > 1) {
    result.validation.warnings.push(`Mixed invoice types detected: ${result.batchSummary.invoiceTypes.join(', ')}`);
  }
  
  // Check processing success rate
  const successRate = (result.processedInvoices / result.totalInvoices) * 100;
  if (successRate < 100) {
    result.validation.warnings.push(`Processing success rate: ${successRate.toFixed(1)}%`);
  }
};

/**
 * Log processing steps
 * @param {Object} result - Result object to add logs to
 * @param {string} message - Log message
 * @param {string} level - Log level (INFO, WARN, ERROR)
 */
const logStep = (result, message, level = 'INFO') => {
  const logEntry = {
    timestamp: new Date().toISOString(),
    level: level,
    message: message
  };
  
  result.logs.push(logEntry);
  console.log(`[${level}] ${message}`);
};

module.exports = {
  processMultipleInvoices,
  detectInvoiceRows,
  enhanceInvoiceData,
  validateIndividualInvoice
};
