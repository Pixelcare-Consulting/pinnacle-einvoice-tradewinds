/**
 * Batch Processing Utility for Multiple Excel Files and Invoices
 * Provides progress tracking, parallel processing, and comprehensive reporting
 */

const fs = require('fs');
const path = require('path');
const { consumeExcelFile } = require('./excelConsumer');

/**
 * Process multiple Excel files in batch with progress tracking
 * @param {Array} filePaths - Array of Excel file paths
 * @param {Object} options - Batch processing options
 * @returns {Object} Batch processing results
 */
const processBatchFiles = async (filePaths, options = {}) => {
  const startTime = new Date();
  
  const batchResult = {
    success: false,
    totalFiles: filePaths.length,
    processedFiles: 0,
    failedFiles: 0,
    totalInvoices: 0,
    processedInvoices: 0,
    files: [],
    batchSummary: {
      totalAmount: 0,
      totalTaxAmount: 0,
      currencies: new Set(),
      invoiceTypes: new Set(),
      suppliers: new Set(),
      buyers: new Set()
    },
    processingTime: 0,
    logs: []
  };

  const {
    maxConcurrency = 3,
    useEnhancedProcessor = true,
    generateDetailedLogs = true,
    onProgress = null
  } = options;

  try {
    logBatchStep(batchResult, `Starting batch processing of ${filePaths.length} files`);

    // Process files with controlled concurrency
    const chunks = chunkArray(filePaths, maxConcurrency);
    
    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
      const chunk = chunks[chunkIndex];
      
      // Process chunk in parallel
      const chunkPromises = chunk.map(async (filePath, fileIndex) => {
        const globalIndex = chunkIndex * maxConcurrency + fileIndex;
        return processFileWithProgress(filePath, globalIndex, batchResult, options);
      });
      
      const chunkResults = await Promise.allSettled(chunkPromises);
      
      // Process chunk results
      chunkResults.forEach((result, index) => {
        const globalIndex = chunkIndex * maxConcurrency + index;
        const filePath = chunk[index];
        
        if (result.status === 'fulfilled') {
          const fileResult = result.value;
          batchResult.files.push(fileResult);
          
          if (fileResult.success) {
            batchResult.processedFiles++;
            batchResult.totalInvoices += fileResult.totalInvoices || 0;
            batchResult.processedInvoices += fileResult.processedInvoices || 0;
            
            // Update batch summary
            updateBatchSummary(batchResult.batchSummary, fileResult);
          } else {
            batchResult.failedFiles++;
          }
        } else {
          batchResult.failedFiles++;
          batchResult.files.push({
            filePath: filePath,
            success: false,
            error: result.reason.message,
            totalInvoices: 0,
            processedInvoices: 0
          });
        }
        
        // Progress callback
        if (onProgress) {
          const progress = {
            current: globalIndex + 1,
            total: batchResult.totalFiles,
            percentage: ((globalIndex + 1) / batchResult.totalFiles * 100).toFixed(1)
          };
          onProgress(progress);
        }
      });
      
      logBatchStep(batchResult, `Completed chunk ${chunkIndex + 1}/${chunks.length}`);
    }

    // Finalize batch processing
    batchResult.success = batchResult.processedFiles > 0;
    batchResult.processingTime = new Date() - startTime;
    
    // Convert Sets to Arrays for JSON serialization
    batchResult.batchSummary.currencies = Array.from(batchResult.batchSummary.currencies);
    batchResult.batchSummary.invoiceTypes = Array.from(batchResult.batchSummary.invoiceTypes);
    batchResult.batchSummary.suppliers = Array.from(batchResult.batchSummary.suppliers);
    batchResult.batchSummary.buyers = Array.from(batchResult.batchSummary.buyers);
    
    logBatchStep(batchResult, `Batch processing completed: ${batchResult.processedFiles}/${batchResult.totalFiles} files, ${batchResult.processedInvoices}/${batchResult.totalInvoices} invoices`);
    
    // Generate batch report if requested
    if (generateDetailedLogs) {
      await generateBatchReport(batchResult, options);
    }
    
  } catch (error) {
    batchResult.success = false;
    batchResult.error = error.message;
    logBatchStep(batchResult, `Batch processing failed: ${error.message}`, 'ERROR');
  }

  return batchResult;
};

/**
 * Process a single file with progress tracking
 * @param {string} filePath - Path to Excel file
 * @param {number} index - File index
 * @param {Object} batchResult - Batch result object for logging
 * @param {Object} options - Processing options
 * @returns {Object} File processing result
 */
const processFileWithProgress = async (filePath, index, batchResult, options) => {
  const fileName = path.basename(filePath);
  
  try {
    logBatchStep(batchResult, `Processing file ${index + 1}: ${fileName}`);
    
    const fileResult = await consumeExcelFile(filePath, {
      useEnhancedProcessor: options.useEnhancedProcessor
    });
    
    // Extract enhanced results if available
    let totalInvoices = 0;
    let processedInvoices = 0;
    
    if (fileResult.enhancedResults) {
      totalInvoices = fileResult.enhancedResults.totalInvoices;
      processedInvoices = fileResult.enhancedResults.processedInvoices;
    } else if (fileResult.processingResults) {
      totalInvoices = fileResult.processingResults.length;
      processedInvoices = fileResult.processingResults.length;
    }
    
    const result = {
      filePath: filePath,
      fileName: fileName,
      success: fileResult.success,
      totalInvoices: totalInvoices,
      processedInvoices: processedInvoices,
      processingTime: fileResult.processingTime,
      enhancedResults: fileResult.enhancedResults,
      error: fileResult.error
    };
    
    logBatchStep(batchResult, `Completed file ${index + 1}: ${fileName} (${processedInvoices}/${totalInvoices} invoices)`);
    
    return result;
    
  } catch (error) {
    logBatchStep(batchResult, `Failed to process file ${index + 1}: ${fileName} - ${error.message}`, 'ERROR');
    
    return {
      filePath: filePath,
      fileName: fileName,
      success: false,
      totalInvoices: 0,
      processedInvoices: 0,
      error: error.message
    };
  }
};

/**
 * Update batch summary with file results
 * @param {Object} summary - Batch summary object
 * @param {Object} fileResult - File processing result
 */
const updateBatchSummary = (summary, fileResult) => {
  if (fileResult.enhancedResults && fileResult.enhancedResults.batchSummary) {
    const fileSummary = fileResult.enhancedResults.batchSummary;
    
    summary.totalAmount += fileSummary.totalAmount || 0;
    summary.totalTaxAmount += fileSummary.totalTaxAmount || 0;
    
    // Add currencies and invoice types
    if (fileSummary.currencies) {
      fileSummary.currencies.forEach(currency => summary.currencies.add(currency));
    }
    if (fileSummary.invoiceTypes) {
      fileSummary.invoiceTypes.forEach(type => summary.invoiceTypes.add(type));
    }
    
    // Add suppliers and buyers
    if (fileResult.enhancedResults.invoices) {
      fileResult.enhancedResults.invoices.forEach(invoice => {
        if (invoice.supplier?.name) {
          summary.suppliers.add(invoice.supplier.name);
        }
        if (invoice.buyer?.name) {
          summary.buyers.add(invoice.buyer.name);
        }
      });
    }
  }
};

/**
 * Generate comprehensive batch report
 * @param {Object} batchResult - Batch processing result
 * @param {Object} options - Report options
 */
const generateBatchReport = async (batchResult, options = {}) => {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const reportDir = path.join(process.cwd(), 'logs', 'batch-reports');
  
  if (!fs.existsSync(reportDir)) {
    fs.mkdirSync(reportDir, { recursive: true });
  }
  
  const reportPath = path.join(reportDir, `batch-report_${timestamp}.json`);
  
  const report = {
    timestamp: new Date().toISOString(),
    batchSummary: {
      totalFiles: batchResult.totalFiles,
      processedFiles: batchResult.processedFiles,
      failedFiles: batchResult.failedFiles,
      successRate: ((batchResult.processedFiles / batchResult.totalFiles) * 100).toFixed(2) + '%',
      totalInvoices: batchResult.totalInvoices,
      processedInvoices: batchResult.processedInvoices,
      invoiceSuccessRate: batchResult.totalInvoices > 0 ? 
        ((batchResult.processedInvoices / batchResult.totalInvoices) * 100).toFixed(2) + '%' : '0%',
      processingTimeMs: batchResult.processingTime
    },
    financialSummary: batchResult.batchSummary,
    fileResults: batchResult.files,
    processingLogs: batchResult.logs
  };
  
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  
  logBatchStep(batchResult, `Batch report generated: ${reportPath}`);
  
  return reportPath;
};

/**
 * Utility function to chunk array for controlled concurrency
 * @param {Array} array - Array to chunk
 * @param {number} size - Chunk size
 * @returns {Array} Array of chunks
 */
const chunkArray = (array, size) => {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
};

/**
 * Log batch processing steps
 * @param {Object} batchResult - Batch result object
 * @param {string} message - Log message
 * @param {string} level - Log level
 */
const logBatchStep = (batchResult, message, level = 'INFO') => {
  const logEntry = {
    timestamp: new Date().toISOString(),
    level: level,
    message: message
  };
  
  batchResult.logs.push(logEntry);
  console.log(`[BATCH ${level}] ${message}`);
};

module.exports = {
  processBatchFiles,
  generateBatchReport,
  updateBatchSummary
};
