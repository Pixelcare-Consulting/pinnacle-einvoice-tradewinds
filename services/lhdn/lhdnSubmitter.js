const {
  getCertificatesHashedParams,
  validateCustomerTin,
  submitDocument
} = require('./lhdnService');
const prisma = require('../../src/lib/prisma');
const moment = require('moment');
const axios = require('axios');
const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');
const XLSX = require('xlsx');
const { getActiveSAPConfig } = require('../../config/paths');
const { processExcelData } = require('./processExcelData');
const { parseStringPromise } = require('xml2js');
const { getTokenSession, getConfig } = require('../token.service');

async function getLHDNConfig() {
    const config = await prisma.wP_CONFIGURATION.findFirst({
        where: {
            Type: 'LHDN',
            IsActive: true
        },
        orderBy: {
            CreateTS: 'desc'
        }
    });

    if (!config || !config.Settings) {
        throw new Error('LHDN configuration not found');
    }

    let settings = typeof config.Settings === 'string' ? JSON.parse(config.Settings) : config.Settings;

    const baseUrl = settings.environment === 'production'
        ? settings.middlewareUrl || settings.middlewareUrl
        : settings.sandboxUrl || settings.middlewareUrl;

    if (!baseUrl) {
        throw new Error('LHDN API URL not configured');
    }

    return {
        baseUrl,
        environment: settings.environment,
        timeout: parseInt(settings.timeout) || 60000,
        retryEnabled: settings.retryEnabled !== false,
        maxRetries: settings.maxRetries || 3,
        retryDelay: settings.retryDelay || 3000,
        maxRetryDelay: settings.maxRetryDelay || 60000
    };
}

class LHDNSubmitter {
  constructor(req) {
    this.req = req;
    this.baseUrl = null;  // Will be set after loading config
    this.loadConfig();  // Initialize configuration
  }

  async loadConfig() {
    try {
      // Get LHDN configuration from database
      const config = await prisma.wP_CONFIGURATION.findFirst({
        where: {
          Type: 'LHDN',
          IsActive: true
        },
        orderBy: {
          CreateTS: 'desc'
        }
      });

      if (!config || !config.Settings) {
        throw new Error('LHDN configuration not found');
      }

      // Parse settings if it's a string
      let settings = typeof config.Settings === 'string' ? JSON.parse(config.Settings) : config.Settings;

      // Set base URL based on environment
      this.baseUrl = settings.environment === 'production'
        ? settings.middlewareUrl || settings.middlewareUrl
        : settings.sandboxUrl || settings.middlewareUrl;

      if (!this.baseUrl) {
        throw new Error('LHDN API URL not configured');
      }


    } catch (error) {
      console.error('Error loading LHDN configuration:', error);
      throw new Error('Failed to load LHDN configuration: ' + error.message);
    }
  }


  async logOperation(description, options = {}) {
    try {
      await prisma.wP_LOGS.create({
        data: {
          Description: description,
          CreateTS: new Date().toISOString(),
          LoggedUser: this.req.session?.user?.username || 'System',
          IPAddress: this.req.ip,
          LogType: options.logType || 'INFO',
          Module: 'OUTBOUND',
          Action: options.action || 'SUBMIT',
          Status: options.status || 'SUCCESS',
          UserID: this.req.session?.user?.id
        }
      });
    } catch (error) {
      console.error('Error creating log:', error);
    }
  }

  async validateCustomerTaxInfo(tin, idType, idValue) {
    try {
      if (!this.req || !this.req.session || !this.req.session.accessToken) {
        throw new Error('No valid authentication token found in session');
      }

      const token = this.req.session.accessToken;
      console.log("Using Login Authentication Token from session");

      // Get settings for validateCustomerTin
      const settings = await getConfig();

      const result = await validateCustomerTin(settings, tin, idType, idValue, token);
      return result;
    } catch (error) {
      await this.logOperation(`Customer tax validation failed for TIN: ${tin}`, {
        status: 'FAILED',
        logType: 'ERROR'
      });
      throw error;
    }
  }

  async prepareDocumentForSubmission(lhdnJson, version) {
    try {
      console.log('Preparing document for submission with version:', version);

      const invoiceNumber = lhdnJson?.Invoice?.[0]?.ID?.[0]?._;
      if (!invoiceNumber) {
        throw new Error('Invoice number not found in the document');
      }

      // Ensure version is set in the document
      if (lhdnJson?.Invoice?.[0]?.InvoiceTypeCode?.[0]) {
        lhdnJson.Invoice[0].InvoiceTypeCode[0].listVersionID = version;
      }

      // Different handling for v1.0 and v1.1
      if (version === '1.1') {
        console.log('Processing as v1.1 document with digital signature');
        const { certificateJsonPortion_Signature, certificateJsonPortion_UBLExtensions } =
          getCertificatesHashedParams(lhdnJson);

        lhdnJson.Invoice[0].Signature = certificateJsonPortion_Signature;
        lhdnJson.Invoice[0].UBLExtensions = certificateJsonPortion_UBLExtensions;
      } else {
        console.log('Processing as v1.0 document without digital signature');
        // Remove UBLExtensions and Signature if they exist
        if (lhdnJson.Invoice?.[0]) {
          delete lhdnJson.Invoice[0].UBLExtensions;
          delete lhdnJson.Invoice[0].Signature;
        }
      }

      // Create payload
      const payload = {
        "documents": [
          {
            "format": "JSON",
            "documentHash": require('crypto')
              .createHash('sha256')
              .update(JSON.stringify(lhdnJson))
              .digest('hex'),
            "codeNumber": invoiceNumber,
            "document": Buffer.from(JSON.stringify(lhdnJson)).toString('base64')
          }
        ]
      };

      await this.logOperation(`Document prepared for submission: ${invoiceNumber}`, {
        action: 'PREPARE_DOCUMENT'
      });

      return { payload, invoice_number: invoiceNumber };
    } catch (error) {
      console.error('Error preparing document:', error);
      await this.logOperation(`Document preparation failed: ${error.message}`, {
        action: 'PREPARE_ERROR',
        status: 'FAILED',
        logType: 'ERROR'
      });
      throw error;
    }
  }

  async prepareXMLDocumentForSubmission(xmlData, version) {
    try {
      const preparedXMLData = xmlData.replace(/<\?xml.*?\?>/, '').trim();
      console.log('Preparing document for submission with version:', version);

      // Parse XML data for validation and extraction
      const parsedXml = await parseStringPromise(preparedXMLData, { explicitArray: false });
      const currentDate = new Date();
      const formattedDate = currentDate.toISOString().split('T')[0];
      const formattedTime = currentDate.toISOString().split('T')[1].split('.')[0] + 'Z';

      const codeNumber = parsedXml?.Invoice?.['cbc:ID'];
      if (!codeNumber) {
        throw new Error('Invoice ID not found in the XML');
      }

      // Update the XML string directly using regex replacements
      let updatedXMLData = preparedXMLData;

      // Update IssueDate
      updatedXMLData = updatedXMLData.replace(
        /<cbc:IssueDate>[^<]+<\/cbc:IssueDate>/,
        `<cbc:IssueDate>${formattedDate}</cbc:IssueDate>`
      );

      // Update IssueTime
      updatedXMLData = updatedXMLData.replace(
        /<cbc:IssueTime>[^<]+<\/cbc:IssueTime>/,
        `<cbc:IssueTime>${formattedTime}</cbc:IssueTime>`
      );

      // Update version if needed
      if (version) {
        updatedXMLData = updatedXMLData.replace(
          /<cbc:InvoiceTypeCode[^>]*>/,
          `<cbc:InvoiceTypeCode listVersionID="${version}">`
        );
      }

      console.log('Prepared XML Data:', updatedXMLData);

      const payload = {
        "documents": [
          {
            "format": "XML",
            "documentHash": require('crypto')
              .createHash('sha256')
              .update(updatedXMLData)
              .digest('hex'),
            "codeNumber": codeNumber,
            "document": Buffer.from(updatedXMLData).toString('base64')
          }
        ]
      };

      await this.logOperation(`Document prepared for submission: ${codeNumber}`, {
        action: 'PREPARE_DOCUMENT'
      });

      return { payload, invoice_number: codeNumber };
    } catch (error) {
      console.error('Error preparing document:', error);

      await this.logOperation(`Document preparation failed: ${error.message}`, {
        action: 'PREPARE_ERROR',
        status: 'FAILED',
        logType: 'ERROR'
      });
      throw error;
    }
  }

  async checkExistingSubmission(fileName) {
    try {
      const docNum = this.extractDocNum(fileName);
      const existing = await prisma.wP_OUTBOUND_STATUS.findFirst({
        where: {
          OR: [
            { invoice_number: docNum },
            { fileName: { contains: docNum } }
          ]
        }
      });

      if (existing && ['Submitted', 'Processing'].includes(existing.status)) {
        return {
          blocked: true,
          response: {
            success: false,
            error: {
              code: 'DUPLICATE_SUBMISSION',
              message: 'This document has already been submitted',
              details: [{
                code: 'DUPLICATE',
                message: `Document with ID ${docNum} was submitted on ${existing.date_submitted}`,
                status: existing.status
              }]
            }
          }
        };
      }

      if (existing) {
        await prisma.wP_OUTBOUND_STATUS.update({
          where: { id: existing.id },
          data: {
            status: 'Processing',
            updated_at: new Date()
          }
        });
      }

      return { blocked: false };
    } catch (error) {
      console.error('Error checking existing submission:', error);
      throw error;
    }
  }

  extractDocNum(fileName) {
    const match = fileName.match(/^(?:\d{2})_([^_]+)_/);
    return match ? match[1] : fileName;
  }

  async getProcessedData(fileName, type, company, date, data = null) {
    try {
      const filePath = await this.constructFilePath(fileName, type, company, date);

      if (data) {
        return {
          ...data,
          filePath
        };
      }

      // Process Excel file and return structured data
      const workbook = XLSX.readFile(filePath);
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      const rawData = XLSX.utils.sheet_to_json(worksheet, {
        raw: true,
        defval: null,
        blankrows: false
      });

      const processedData = processExcelData(rawData);
      if (!processedData || !Array.isArray(processedData) || processedData.length === 0) {
        throw new Error('No valid documents found in Excel file');
      }

      return processedData;
    } catch (error) {
      console.error('Error processing document data:', error);
      throw error;
    }
  }

  async getProcessedDataConsolidated(fileName, type, company, date, data = null) {
    try {
      const filePath = await this.constructFilePathConsolidated(fileName, type, company, date);

      if (data) {
        return {
          ...data,
          filePath
        };
      }

      // Process Excel file and return structured data
      const workbook = XLSX.readFile(filePath);
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      const rawData = XLSX.utils.sheet_to_json(worksheet, {
        raw: true,
        defval: null,
        blankrows: false
      });

      const processedData = processExcelData(rawData);
      if (!processedData || !Array.isArray(processedData) || processedData.length === 0) {
        throw new Error('No valid documents found in Excel file');
      }

      return processedData;
    } catch (error) {
      console.error('Error processing document data:', error);
      throw error;
    }
  }


  async constructFilePathConsolidated(fileName, type, company, date) {
    try {
      if (!fileName || !type || !company || !date) {
        throw new Error('Missing required parameters for file path construction');
      }


      const networkPath = 'C:\\SFTPRoot_Consolidation';

      const config = await getActiveSAPConfig();
      if (!config.success) {
        throw new Error(config.error || 'Failed to get SAP configuration');
      }

      // Format the date consistently
      const formattedDate = moment(date).format('YYYY-MM-DD');
   //  console.log('Formatted date:', formattedDate);

      // Construct the full path WITHOUT duplicating "Incoming"
      const filePath = path.join(networkPath, 'Incoming', company, formattedDate, fileName);
     // console.log('Constructed file path:', filePath);

      // Verify the file exists
      if (!fs.existsSync(filePath)) {
        console.error(`File not found at path: ${filePath}`);
        console.error('Path components:', {
          networkPath,
          company,
          formattedDate,
          fileName
        });
        throw new Error(`File not found: ${fileName}`);
      }

     // console.log('File found at path:', filePath);
      return filePath;
    } catch (error) {
      if (error.message.includes('File not found')) {
        throw error;
      }
      console.error('Error constructing file path:', error);
      throw new Error(`Failed to construct file path: ${error.message}`);
    }
  }

  async constructFilePath(fileName, type, company, date) {
    try {
      if (!fileName || !type || !company || !date) {
        throw new Error('Missing required parameters for file path construction');
      }

     // console.log('Constructing file path with:', {
     //   fileName,
     //   type,
     //   company,
     //   date,
     // });

      const config = await getActiveSAPConfig();
      if (!config.success) {
        throw new Error(config.error || 'Failed to get SAP configuration');
      }

      // Use the networkPath from config
      const networkPath = config.networkPath;
      if (!networkPath) {
        throw new Error('Network path not found in SAP configuration');
      }

     // console.log('Using network path:', networkPath);

      // Format the date consistently
      const formattedDate = moment(date).format('YYYY-MM-DD');
     // console.log('Formatted date:', formattedDate);

      // Construct the full path
      const filePath = path.join(networkPath, type, company, formattedDate, fileName);
     // console.log('Constructed file path:', filePath);

      // Verify the file exists with enhanced error handling
      if (!fs.existsSync(filePath)) {
        console.error(`File not found at path: ${filePath}`);
        console.error('Path components:', {
          networkPath,
          type,
          company,
          formattedDate,
          fileName
        });

        // Check if the directory exists to provide more specific error information
        const directoryPath = path.join(networkPath, type, company, formattedDate);
        const directoryExists = fs.existsSync(directoryPath);
        const networkPathExists = fs.existsSync(networkPath);
        const typePathExists = fs.existsSync(path.join(networkPath, type));
        const companyPathExists = fs.existsSync(path.join(networkPath, type, company));

        console.error('Directory existence check:', {
          networkPath: networkPathExists,
          typePath: typePathExists,
          companyPath: companyPathExists,
          fullDirectory: directoryExists,
          directoryPath
        });

        // Provide more detailed error message based on what exists
        let errorMessage = `File not found: ${fileName}`;
        let errorDetails = [];

        if (!networkPathExists) {
          errorMessage = `Network path is not accessible: ${networkPath}`;
          errorDetails.push('The configured network path cannot be accessed. Please check your SAP configuration and network connectivity.');
        } else if (!typePathExists) {
          errorMessage = `Document type directory not found: ${type}`;
          errorDetails.push(`The document type directory "${type}" does not exist in the network path.`);
        } else if (!companyPathExists) {
          errorMessage = `Company directory not found: ${company}`;
          errorDetails.push(`The company directory "${company}" does not exist under document type "${type}".`);
        } else if (!directoryExists) {
          errorMessage = `Date directory not found: ${formattedDate}`;
          errorDetails.push(`The date directory "${formattedDate}" does not exist under company "${company}".`);
        } else {
          errorMessage = `File not found in directory: ${fileName}`;
          errorDetails.push(`The file "${fileName}" does not exist in the expected directory.`);

          // Try to list files in the directory to help with debugging
          try {
            const filesInDirectory = fs.readdirSync(directoryPath);
            console.log('Files in directory:', filesInDirectory);
            if (filesInDirectory.length > 0) {
              errorDetails.push(`Available files in directory: ${filesInDirectory.slice(0, 10).join(', ')}${filesInDirectory.length > 10 ? '...' : ''}`);
            } else {
              errorDetails.push('The directory is empty.');
            }
          } catch (readDirError) {
            console.error('Error reading directory:', readDirError);
            errorDetails.push('Unable to read directory contents.');
          }
        }

        const fullErrorMessage = `${errorMessage}\n\nPath Details:\n- Full Path: ${filePath}\n- Network Path: ${networkPath}\n- Type: ${type}\n- Company: ${company}\n- Date: ${formattedDate}\n- File: ${fileName}\n\nTroubleshooting:\n${errorDetails.join('\n')}`;

        throw new Error(fullErrorMessage);
      }

      //console.log('File found at path:', filePath);
      return filePath;
    } catch (error) {
      if (error.message.includes('File not found')) {
        throw error;
      }
      console.error('Error constructing file path:', error);
      throw new Error(`Failed to construct file path: ${error.message}`);
    }
  }

  /**
   * Parse complex LHDN validation errors and extract meaningful information
   * @param {Object} rejectedDoc - The rejected document from LHDN response
   * @returns {Object} Enhanced error object with parsed validation details
   */
  parseLHDNValidationError(rejectedDoc) {
    try {
      console.log('Parsing LHDN validation error:', JSON.stringify(rejectedDoc, null, 2));

      // Initialize the enhanced error object
      const enhancedError = {
        code: 'CF404', // Use a specific LHDN error code that the UI helper recognizes
        message: rejectedDoc.error?.message || rejectedDoc.message || 'Missing required field. Please ensure all required fields are completed.',
        details: [],
        invoiceNumber: rejectedDoc.invoiceCodeNumber || rejectedDoc.codeNumber || 'Unknown'
      };

      // Check if there's an error object with details
      if (rejectedDoc.error && rejectedDoc.error.details) {
        const errorDetails = Array.isArray(rejectedDoc.error.details)
          ? rejectedDoc.error.details
          : [rejectedDoc.error.details];

        console.log('Processing error details:', errorDetails.length, 'items');

        // Process each validation error detail
        errorDetails.forEach((detail) => {
          const parsedDetails = this.parseValidationDetail(detail);
          if (parsedDetails && Array.isArray(parsedDetails)) {
            enhancedError.details.push(...parsedDetails);
          }
        });
      }

      // If no specific details found, try to extract from the main error structure
      if (enhancedError.details.length === 0 && rejectedDoc.error) {
        const fallbackDetails = this.parseValidationDetail(rejectedDoc.error);
        if (fallbackDetails && Array.isArray(fallbackDetails)) {
          enhancedError.details.push(...fallbackDetails);
        }
      }

      // If still no details, create a generic error
      if (enhancedError.details.length === 0) {
        enhancedError.details.push({
          code: enhancedError.code,
          message: enhancedError.message,
          field: 'Document Data',
          userMessage: 'The document contains validation errors',
          guidance: ['Review all document fields for accuracy', 'Ensure all required fields are completed']
        });
      }

      console.log('Enhanced LHDN error:', JSON.stringify(enhancedError, null, 2));
      return enhancedError;

    } catch (error) {
      console.error('Error parsing LHDN validation error:', error);
      return {
        code: rejectedDoc.code || 'PARSING_ERROR',
        message: rejectedDoc.message || 'Unable to process validation error details',
        details: [{
          code: 'PARSING_ERROR',
          message: 'Unable to process the validation error details',
          field: 'System',
          userMessage: 'Unable to process the validation error details',
          guidance: ['Please contact support for assistance']
        }],
        invoiceNumber: rejectedDoc.invoiceCodeNumber || rejectedDoc.codeNumber || 'Unknown'
      };
    }
  }

  /**
   * Map LHDN error codes to standard error codes following LHDN documentation
   * @param {string} lhdnCode - The LHDN error code
   * @param {string} errorType - The type of error detected
   * @returns {string} Standard error code
   */
  mapToStandardErrorCode(lhdnCode, errorType) {
    // Map based on LHDN standard error response structure
    const errorCodeMap = {
      // Validation errors (HTTP 400 - BadRequest)
      'VALIDATION_ERROR': 'BadRequest',
      'MISSING_COUNTRY_CODE': 'BadArgument',
      'INVALID_PHONE_FORMAT': 'BadArgument',
      'INVALID_IDENTIFICATION': 'BadArgument',
      'PROPERTY_REQUIRED': 'BadArgument',
      'ARRAY_ITEM_NOT_VALID': 'BadRequest',

      // Specific field validation errors
      'MISSING_UNIT_CODE': 'BadArgument',
      'MISSING_QUANTITY': 'BadArgument',
      'MISSING_LINE_AMOUNT': 'BadArgument',
      'MISSING_TAX_AMOUNT': 'BadArgument',
      'INVOICE_LINE_ERROR': 'BadRequest',
      'TAX_CALCULATION_ERROR': 'BadRequest',

      // Structure validation errors
      'STRUCTURE_VALIDATION': 'BadRequest',
      'CORE_FIELDS_VALIDATION': 'BadRequest',

      // Authentication/Authorization errors
      'UNAUTHORIZED': 'Unauthorized',
      'FORBIDDEN': 'Forbidden',

      // Server errors
      'INTERNAL_ERROR': 'InternalServerError',
      'SERVICE_UNAVAILABLE': 'ServiceUnavailable',

      // Parsing errors
      'PARSING_ERROR': 'BadRequest'
    };

    // Return mapped code or default to the error type
    return errorCodeMap[errorType] || errorCodeMap[lhdnCode] || 'BadRequest';
  }

  /**
   * Extract all validation errors from nested LHDN error structure
   * @param {string} message - The nested error message from LHDN
   * @returns {Array} Array of individual error objects
   */
  extractNestedValidationErrors(message) {
    const errors = [];

    if (!message) return errors;

    try {
      console.log('Extracting LHDN validation errors from:', message);

      // Look for StringExpected errors (missing required string fields)
      const stringExpectedRegex = /StringExpected:\s*([^}\n]+)/g;
      let stringMatch;

      while ((stringMatch = stringExpectedRegex.exec(message)) !== null) {
        const propertyPath = stringMatch[1].trim();
        console.log('Found StringExpected error:', propertyPath);

        const errorDetail = this.parseStringExpectedError(propertyPath);
        if (errorDetail) {
          errors.push(errorDetail);
        }
      }

      // Look for PropertyRequired errors which indicate specific missing fields
      const propertyRequiredRegex = /PropertyRequired:\s*([^,}]+)/g;
      let match;

      while ((match = propertyRequiredRegex.exec(message)) !== null) {
        const propertyPath = match[1].trim();

        // Extract meaningful information from the property path
        let errorType = 'VALIDATION_ERROR';
        let fieldDescription = 'A required field is missing';
        let userMessage = 'A required field is missing from your invoice';

        if (propertyPath.includes('Country') && propertyPath.includes('IdentificationCode')) {
          errorType = 'MISSING_COUNTRY_CODE';
          if (propertyPath.includes('AccountingSupplierParty')) {
            fieldDescription = 'Supplier country code is required';
            userMessage = 'Your supplier address is missing a country code';
          } else if (propertyPath.includes('AccountingCustomerParty')) {
            fieldDescription = 'Customer country code is required';
            userMessage = 'Your customer address is missing a country code';
          } else if (propertyPath.includes('Delivery')) {
            fieldDescription = 'Delivery country code is required';
            userMessage = 'Your delivery address is missing a country code';
          } else {
            fieldDescription = 'Country code is required';
            userMessage = 'A country code is missing from one of your addresses';
          }
        } else if (propertyPath.includes('Contact') && propertyPath.includes('Telephone')) {
          errorType = 'INVALID_PHONE_FORMAT';
          if (propertyPath.includes('AccountingSupplierParty')) {
            fieldDescription = 'Supplier phone number format is invalid';
            userMessage = 'Your supplier phone number format is incorrect';
          } else {
            fieldDescription = 'Phone number format is invalid';
            userMessage = 'A phone number format is incorrect';
          }
        } else if (propertyPath.includes('PartyIdentification') && propertyPath.includes('ID')) {
          errorType = 'INVALID_IDENTIFICATION';
          if (propertyPath.includes('AccountingSupplierParty')) {
            fieldDescription = 'Supplier identification number is invalid';
            userMessage = 'There is an issue with your supplier identification number';
          } else {
            fieldDescription = 'Identification number is invalid';
            userMessage = 'There is an issue with an identification number';
          }
        }

        errors.push({
          type: errorType,
          propertyPath: propertyPath,
          fieldDescription: fieldDescription,
          userMessage: userMessage,
          originalPath: propertyPath
        });
      }

      // Look for ArrayItemNotValid patterns which might contain nested errors
      const arrayItemRegex = /ArrayItemNotValid:\s*([^{}\n]+)/g;
      let arrayMatch;

      while ((arrayMatch = arrayItemRegex.exec(message)) !== null) {
        const arrayPath = arrayMatch[1].trim();
        console.log('Found ArrayItemNotValid pattern:', arrayPath);

        // These are usually container errors, but we can provide context
        if (arrayPath.includes('InvoiceLine')) {
          // Check if this is specifically about InvoicedQuantity and unitCode
          if (message.includes('InvoicedQuantity') && message.includes('unitCode')) {
            errors.push({
              type: 'MISSING_UNIT_CODE',
              propertyPath: arrayPath,
              fieldDescription: 'Unit code is missing from invoice line item',
              userMessage: 'The unit code is missing from one of your invoice items',
              guidance: [
                'Please add a unit code to your invoice item (e.g., "C62" for pieces, "KGM" for kilograms).',
                'Common unit codes: C62 (pieces), KGM (kilograms), MTR (meters), LTR (liters).',
                'The unit code must match the quantity type you are selling.',
                'You can find this field in the invoice items section next to the quantity.'
              ],
              originalPath: arrayPath,
              _isUserFriendly: true
            });
          } else if (message.includes('InvoicedQuantity')) {
            errors.push({
              type: 'MISSING_QUANTITY',
              propertyPath: arrayPath,
              fieldDescription: 'Quantity information is missing from invoice line item',
              userMessage: 'The quantity information is missing or invalid for one of your invoice items',
              guidance: [
                'Please enter a valid quantity for your invoice item.',
                'The quantity must be a positive number.',
                'Make sure both the quantity value and unit code are provided.',
                'You can find this field in the invoice items section.'
              ],
              originalPath: arrayPath,
              _isUserFriendly: true
            });
          } else {
            errors.push({
              type: 'INVOICE_LINE_ERROR',
              propertyPath: arrayPath,
              fieldDescription: 'Invoice line item validation error',
              userMessage: 'There is an issue with one of your invoice line items',
              guidance: [
                'Check all invoice line items for missing or invalid data',
                'Ensure all required fields are filled in each line item',
                'Verify unit codes, quantities, and prices are correct'
              ],
              originalPath: arrayPath,
              _isUserFriendly: true
            });
          }
        }
      }

      console.log(`Total errors extracted: ${errors.length}`);

      // If still no errors found, create a generic error
      if (errors.length === 0) {
        errors.push({
          type: 'VALIDATION_ERROR',
          propertyPath: '',
          fieldDescription: 'Document validation failed',
          userMessage: 'Your invoice contains validation errors that need to be corrected',
          guidance: [
            'Please review all fields in your Excel file for accuracy',
            'Ensure all required fields are completed',
            'Check that all data follows the correct format requirements'
          ],
          originalPath: 'Document',
          _isUserFriendly: true
        });
      }

      // If no PropertyRequired errors found, look for other patterns
      if (errors.length === 0) {
        // Look for ArrayItemNotValid patterns to understand the context
        if (message.includes('AccountingSupplierParty') && message.includes('Country')) {
          errors.push({
            type: 'VALIDATION_ERROR',
            propertyPath: 'AccountingSupplierParty.Country',
            fieldDescription: 'Supplier address validation error',
            userMessage: 'There is an issue with your supplier address information',
            originalPath: 'Supplier Address'
          });
        }
      }

    } catch (error) {
      console.error('Error extracting nested validation errors:', error);
      // Return a generic error if parsing fails
      errors.push({
        type: 'PARSING_ERROR',
        propertyPath: '',
        fieldDescription: 'Unable to parse error details',
        userMessage: 'There is an issue with your invoice that needs to be corrected',
        originalPath: 'Unknown'
      });
    }

    return errors;
  }

  /**
   * Parse StringExpected error into user-friendly format
   * @param {string} propertyPath - The property path from LHDN error
   * @returns {Object|null} Parsed error object or null
   */
  parseStringExpectedError(propertyPath) {
    try {
      let errorType = 'MISSING_FIELD';
      let fieldDescription = 'A required field is missing';
      let userMessage = 'A required field is missing from your invoice';
      let guidance = [];

      // Parse the property path to understand what's missing
      if (propertyPath.includes('unitCode')) {
        errorType = 'MISSING_UNIT_CODE';
        fieldDescription = 'Unit code is missing from invoice line item';
        userMessage = 'The unit code is missing from one of your invoice items';
        guidance = [
          'Please add a unit code to your invoice item (e.g., "C62" for pieces, "KGM" for kilograms).',
          'Common unit codes: C62 (pieces), KGM (kilograms), MTR (meters), LTR (liters).',
          'The unit code must match the quantity type you are selling.',
          'You can find this field in the invoice items section next to the quantity.'
        ];
      } else if (propertyPath.includes('InvoicedQuantity')) {
        errorType = 'MISSING_QUANTITY';
        fieldDescription = 'Quantity is missing from invoice line item';
        userMessage = 'The quantity information is missing or invalid for one of your invoice items';
        guidance = [
          'Please enter a valid quantity for your invoice item.',
          'The quantity must be a positive number.',
          'Make sure both the quantity value and unit code are provided.',
          'You can find this field in the invoice items section.'
        ];
      } else if (propertyPath.includes('LineExtensionAmount')) {
        errorType = 'MISSING_LINE_AMOUNT';
        fieldDescription = 'Line amount is missing from invoice line item';
        userMessage = 'The line amount is missing or invalid for one of your invoice items';
        guidance = [
          'Please enter a valid line amount for your invoice item.',
          'The line amount should be the total before tax for this item.',
          'Make sure the amount is a positive number with proper decimal formatting.',
          'You can find this field in the invoice items section.'
        ];
      } else if (propertyPath.includes('TaxAmount')) {
        errorType = 'MISSING_TAX_AMOUNT';
        fieldDescription = 'Tax amount is missing';
        userMessage = 'The tax amount is missing or invalid';
        guidance = [
          'Please enter a valid tax amount.',
          'The tax amount should match the calculated tax for your items.',
          'Make sure the amount is properly formatted with decimals.',
          'You can find this field in the tax information section.'
        ];
      } else if (propertyPath.includes('TaxCategory')) {
        errorType = 'MISSING_TAX_CATEGORY';
        fieldDescription = 'Tax category is missing';
        userMessage = 'Tax category information is missing from your invoice';
        guidance = [
          'Ensure all tax categories are properly specified',
          'Check tax classification codes in your Excel file',
          'Verify tax scheme and category codes are valid'
        ];
      } else if (propertyPath.includes('Country')) {
        errorType = 'MISSING_COUNTRY_CODE';
        fieldDescription = 'Country code is missing';
        userMessage = 'Country code is missing from address information';
        guidance = [
          'Add country codes to all address fields',
          'Use ISO country codes (e.g., "MY" for Malaysia)',
          'Check supplier, buyer, and delivery address fields'
        ];
      } else {
        // Generic missing field
        const fieldName = this.extractFieldNameFromPath(propertyPath);
        fieldDescription = `${fieldName} is missing`;
        userMessage = `The field "${fieldName}" is required but missing from your invoice`;
        guidance = [
          `Please provide a value for the "${fieldName}" field`,
          'Check your Excel file for empty required fields',
          'Ensure all mandatory information is complete'
        ];
      }

      return {
        type: errorType,
        propertyPath: propertyPath,
        fieldDescription: fieldDescription,
        userMessage: userMessage,
        guidance: guidance,
        originalPath: propertyPath,
        _isUserFriendly: true
      };

    } catch (error) {
      console.error('Error parsing StringExpected error:', error);
      return null;
    }
  }

  /**
   * Extract field name from property path
   * @param {string} propertyPath - The property path
   * @returns {string} Extracted field name
   */
  extractFieldNameFromPath(propertyPath) {
    try {
      // Extract the last part of the path after the last dot or slash
      const parts = propertyPath.split(/[.\/]/);
      const lastPart = parts[parts.length - 1];

      // Remove array indices and clean up
      const fieldName = lastPart.replace(/\[\d+\]/g, '').replace(/[#]/g, '');

      // Convert camelCase to readable format
      return fieldName.replace(/([A-Z])/g, ' $1').trim() || 'Unknown Field';
    } catch (error) {
      return 'Unknown Field';
    }
  }

  /**
   * Parse individual validation detail and convert to user-friendly format
   * @param {Object} detail - Individual validation error detail
   * @returns {Array} Array of parsed validation details in plain English
   */
  parseValidationDetail(detail) {
    try {
      if (!detail) return [];

      console.log('Parsing validation detail:', JSON.stringify(detail, null, 2));

      const propertyPath = detail.propertyPath || detail.field || '';
      const message = detail.message || detail.error || '';
      const code = detail.code || detail.errorCode || 'VALIDATION_ERROR';

      // Check if this is a complex nested error structure
      if (message.includes('ArrayItemNotValid') || message.includes('StringExpected') || message.includes('PropertyRequired')) {
        console.log('Detected complex nested error structure, extracting multiple errors...');

        const nestedErrors = this.extractNestedValidationErrors(message);
        const parsedErrors = [];

        for (const nestedError of nestedErrors) {
          // Parse each nested error using existing logic
          const fieldInfo = this.parsePropertyPath(nestedError.propertyPath, message);
          const userFriendlyInfo = this.generateUserFriendlyMessage(nestedError.propertyPath, message);

          // Map to standard error code following LHDN documentation
          const standardErrorCode = this.mapToStandardErrorCode(code, nestedError.type);

          parsedErrors.push({
            code: standardErrorCode,
            errorCode: nestedError.type || code, // Keep original LHDN error code
            originalMessage: message,
            userMessage: userFriendlyInfo.userMessage || nestedError.userMessage,
            guidance: userFriendlyInfo.guidance || [
              'Please review the specified field in your invoice.',
              'Make sure all required information is provided.',
              'Check that the data format meets LHDN requirements.'
            ],
            fieldDescription: fieldInfo.friendlyDescription || nestedError.fieldDescription,
            severity: 'error',
            // Follow LHDN standard error response structure
            propertyName: fieldInfo.field || 'unknown field',
            propertyPath: nestedError.propertyPath,
            target: fieldInfo.location || 'unknown location',
            // Hide technical details from user interface
            _technical: {
              propertyPath: nestedError.propertyPath,
              field: fieldInfo.field || 'unknown field',
              location: fieldInfo.location || 'unknown location',
              originalPath: nestedError.originalPath
            }
          });
        }

        return parsedErrors;
      } else {
        // Handle simple error structure (existing logic)
        const fieldInfo = this.parsePropertyPath(propertyPath, message);
        const userFriendlyInfo = this.generateUserFriendlyMessage(propertyPath, message);

        // Map to standard error code following LHDN documentation
        const standardErrorCode = this.mapToStandardErrorCode(code, 'VALIDATION_ERROR');

        return [{
          code: standardErrorCode,
          errorCode: code, // Keep original LHDN error code
          originalMessage: message,
          userMessage: userFriendlyInfo.userMessage,
          guidance: userFriendlyInfo.guidance,
          fieldDescription: fieldInfo.friendlyDescription || userFriendlyInfo.userMessage,
          severity: 'error',
          // Follow LHDN standard error response structure
          propertyName: fieldInfo.field,
          propertyPath: propertyPath,
          target: fieldInfo.location,
          // Hide technical details from user interface
          _technical: {
            propertyPath: propertyPath,
            field: fieldInfo.field,
            location: fieldInfo.location
          }
        }];
      }

    } catch (error) {
      console.error('Error parsing validation detail:', error);
      return [{
        code: 'BadRequest',
        errorCode: 'PARSING_ERROR',
        userMessage: 'There was an issue processing this error information.',
        guidance: [
          'Please review your invoice data for any obvious issues.',
          'Contact support if you need assistance with this error.'
        ],
        fieldDescription: 'Unable to determine the specific issue',
        severity: 'error',
        // Follow LHDN standard error response structure
        propertyName: 'error processing',
        propertyPath: null,
        target: 'error information'
      }];
    }
  }


  /**
   * Pre-submission validation for a batch of documents. If any document fails,
   * the entire batch must NOT be submitted to LHDN.
   * - Validates Buyer SST registration number format (matches LHDN expectations)
   * - Optionally validates Buyer TIN using LHDN Taxpayer Validation API when ID info is available
   *
   * Returns a structured error when validation fails.
   */
  async preValidateDocuments(docs) {
    const batchErrors = [];

    // Helper: decode a base64 JSON document
    const decodeJsonDoc = (doc) => {
      try {
        const jsonStr = Buffer.from(doc.document, 'base64').toString();
        return JSON.parse(jsonStr);
      } catch (e) {
        return null;
      }
    };

    // Helper: extract Buyer PartyIdentification array and invoice number
    const extractBuyerInfo = (json) => {
      const invoice = json?.Invoice?.[0];
      const invoiceNumber = invoice?.ID?.[0]?._ || 'Unknown';
      const buyerPartyIdent = invoice?.AccountingCustomerParty?.[0]?.Party?.[0]?.PartyIdentification || [];
      return { invoiceNumber, buyerPartyIdent };
    };

    // Helper: validate SST number format (when provided)
    const isValidSST = (value) => {
      if (!value) return true; // empty is allowed; we only validate when present
      const v = String(value).trim();
      if (!v || v.toUpperCase() === 'NA') return true; // treat NA/blank as not provided
      // LHDN/Customs SST number format e.g., W10-0123-12345678
      return /^W\d{2}-\d{4}-\d{8}$/i.test(v);
    };

    // Iterate all docs and collect validation errors
    for (let i = 0; i < (docs?.length || 0); i++) {
      const doc = docs[i];
      const format = doc?.format || 'JSON';
      let json; // normalized JSON invoice for validation

      if (!doc || !doc.document) {
        batchErrors.push({
          index: i,
          invoiceNumber: 'Unknown',
          errors: [{ code: 'INVALID_DOC', message: 'Missing document payload' }]
        });
        continue;
      }

      if (format === 'JSON') {
        json = decodeJsonDoc(doc);
      } else if (format === 'XML') {
        try {
          const xmlStr = Buffer.from(doc.document, 'base64').toString();
          const parsed = await parseStringPromise(xmlStr, { explicitArray: true });
          json = parsed; // best-effort; structure differs but we won’t block on XML specifics
        } catch (e) {
          batchErrors.push({
            index: i,
            invoiceNumber: 'Unknown',
            errors: [{ code: 'INVALID_XML', message: 'Unable to parse XML document for validation' }]
          });
          continue;
        }
      }

      if (!json) {
        batchErrors.push({
          index: i,
          invoiceNumber: 'Unknown',
          errors: [{ code: 'INVALID_JSON', message: 'Unable to parse JSON document for validation' }]
        });
        continue;
      }

      const { invoiceNumber, buyerPartyIdent } = extractBuyerInfo(json);
      const docErrors = [];

      // Validate Buyer SST registration number format when present
      try {
        const sstEntry = Array.isArray(buyerPartyIdent)
          ? buyerPartyIdent.find(p => p?.ID?.[0]?.schemeID === 'SST')
          : null;
        const sstValue = sstEntry?.ID?.[0]?._;
        if (sstValue && !isValidSST(sstValue)) {
          docErrors.push({
            code: 'CF406',
            field: 'Buyer.SST',
            message: 'Enter valid SST registration number - BUYER',
            value: sstValue
          });
        }
      } catch (_) { /* no-op */ }

      // Optional Buyer TIN validation against LHDN when we have both TIN and any ID type/value
      try {
        const tinEntry = Array.isArray(buyerPartyIdent)
          ? buyerPartyIdent.find(p => p?.ID?.[0]?.schemeID === 'TIN')
          : null;
        const tin = tinEntry?.ID?.[0]?._;

        // Find supporting ID (priority: BRN, NRIC, PASSPORT, ARMY)
        const idTypes = ['BRN', 'NRIC', 'PASSPORT', 'ARMY'];
        let idType = null; let idValue = null;
        if (Array.isArray(buyerPartyIdent)) {
          for (const t of idTypes) {
            const e = buyerPartyIdent.find(p => p?.ID?.[0]?.schemeID === t);
            const val = e?.ID?.[0]?._;
            if (val) { idType = t; idValue = String(val).trim(); break; }
          }
        }

        // Only call when all inputs present, token available, and values are non-empty
        if (this.req && this.req.session && this.req.session.accessToken && tin && idType && idValue) {
          try {
            const result = await this.validateCustomerTaxInfo(String(tin).trim(), idType, idValue);
            if (!result || result.status !== 'success') {
              docErrors.push({
                code: 'ERR406',
                field: 'Buyer.TIN',
                message: 'Buyer TIN is invalid. Kindly use the Search TIN function to get the correct TIN',
                value: tin
              });
            }
          } catch (e) {
            // Treat API negative/400 responses as validation failure
            docErrors.push({
              code: 'ERR406',
              field: 'Buyer.TIN',
              message: 'Buyer TIN is invalid. Kindly use the Search TIN function to get the correct TIN',
              value: tin,
              _tech: e?.message
            });
          }
        }
      } catch (_) { /* no-op */ }

      if (docErrors.length > 0) {
        batchErrors.push({ index: i, invoiceNumber, errors: docErrors });
      }
    }

    if (batchErrors.length > 0) {
      const errorPayload = {
        code: 'PRE_SUBMISSION_VALIDATION_FAILED',
        message: `${batchErrors.length} document(s) failed pre-submission validation. Submission aborted.`,
        details: batchErrors
      };

      await this.logOperation(`Pre-submission validation failed for ${batchErrors.length} document(s)`, {
        action: 'PRE_SUBMIT_VALIDATE',
        status: 'FAILED',
        logType: 'ERROR'
      });

      return { isValid: false, error: errorPayload };
    }

    return { isValid: true };
  }

  async submitToLHDNDocument(docs) {
    try {
      // Get token from session
      let token;

      // First try to get token from the request session
      if (this.req && this.req.session && this.req.session.accessToken) {
        console.log('Using existing token from session');
        token = this.req.session.accessToken;
      } else {
        // Fallback to getting a new token only if not available in session
        console.log('No token found in session, getting a new one');
        token = await getTokenSession();
      }

      if (!token) {
        throw new Error('No valid authentication token found');
      }


	      // Pre-submission validation - abort the whole batch if any document fails
	      const preVal = await this.preValidateDocuments(docs, token);
	      if (!preVal.isValid) {
	        return { status: 'failed', error: preVal.error };
	      }

      // Extract and log the document TIN for debugging
      if (docs && docs.length > 0 && docs[0].document) {
        try {
          const docJson = JSON.parse(Buffer.from(docs[0].document, 'base64').toString());
          const docTin = docJson?.Invoice?.[0]?.AccountingSupplierParty?.[0]?.Party?.[0]?.PartyTaxScheme?.[0]?.CompanyID?.[0]?._ || 'TIN not found';
          console.log('Document Supplier TIN:', docTin);

          if (this.req && this.req.session && this.req.session.user) {
            console.log('Session User TIN:', this.req.session.user.tin || 'Not available');
          }
        } catch (parseError) {
          console.error('Error parsing document to extract TIN:', parseError);
        }
      }

      // Optional pre-validation: compare supplier TIN in document with configured TIN (if available)
      try {
        const settings = await getConfig();
        const configuredTin = settings?.tin || this.req?.session?.user?.tin;
        if (configuredTin && docs && docs.length > 0) {
          const docJson = JSON.parse(Buffer.from(docs[0].document, 'base64').toString());
          const supplierTin = docJson?.Invoice?.[0]?.AccountingSupplierParty?.[0]?.Party?.[0]?.PartyTaxScheme?.[0]?.CompanyID?.[0]?._;
          if (supplierTin && configuredTin && supplierTin !== configuredTin) {
            return {
              status: 'failed',
              error: {
                code: 'TIN_MISMATCH',
                message: 'The authenticated TIN and the document supplier TIN do not match.',
                details: [{ code: 'TIN_MISMATCH', target: supplierTin, message: `Document TIN ${supplierTin} does not match configured/authenticated TIN ${configuredTin}.` }]
              }
            };
          }
        }
      } catch (tinCheckErr) {
        console.warn('TIN pre-validation skipped:', tinCheckErr?.message);
      }


      const result = await submitDocument(docs, token);
      console.log('Submission result:', JSON.stringify(result, null, 2));

      // Check for undefined or malformed response
      if (!result) {
        return {
          status: 'failed',
          error: {
            code: 'EMPTY_RESPONSE',
            message: 'No response received from LHDN. The service might be unavailable.',
            details: [{
              code: 'EMPTY_RESPONSE',
              message: 'The LHDN API returned an empty response. Please try again later or contact support.',
              target: docs[0]?.codeNumber || 'Unknown'
            }]
          }
        };
      }

      // Check if response is successful but empty
      if (result.status === 'success' && (!result.data || result.data === undefined)) {
        return {
          status: 'failed',
          error: {
            code: 'INVALID_RESPONSE',
            message: 'LHDN returned an invalid response format. No documents were accepted or rejected.',
            details: [{
              code: 'INVALID_RESPONSE',
              message: 'The LHDN API returned a success status but with no document details. Please try again later.',
              target: docs[0]?.codeNumber || 'Unknown'
            }]
          }
        };
      }

      // Check if there are rejected documents
      if (result.data?.rejectedDocuments?.length > 0) {
        const rejectedDoc = result.data.rejectedDocuments[0];

        // Parse the complex validation error structure
        const enhancedError = this.parseLHDNValidationError(rejectedDoc);

        return {
          status: 'failed',
          error: enhancedError
        };
      }

      // Check if the result doesn't have expected properties
      if (result.data && !result.data.acceptedDocuments && !result.data.rejectedDocuments) {
        return {
          status: 'failed',
          error: {
            code: 'UNEXPECTED_RESPONSE',
            message: 'LHDN returned an unexpected response format. Please verify the document status manually.',
            details: [{
              code: 'UNEXPECTED_RESPONSE',
              message: 'The API response did not contain information about accepted or rejected documents.',
              target: docs[0]?.codeNumber || 'Unknown',
              response: JSON.stringify(result)
            }]
          }
        };
      }

      // If we have an empty acceptedDocuments array, inform the user
      if (result.data && Array.isArray(result.data.acceptedDocuments) && result.data.acceptedDocuments.length === 0 &&
          (!result.data.rejectedDocuments || result.data.rejectedDocuments.length === 0)) {
        return {
          status: 'failed',
          error: {
            code: 'NO_DOCUMENT_PROCESSED',
            message: 'No documents were accepted or rejected by LHDN. The submission may not have been processed correctly.',
            details: [{
              code: 'NO_DOCUMENT_PROCESSED',
              message: 'The LHDN API returned empty document lists. Please verify the document status in the LHDN portal.',
              target: docs[0]?.codeNumber || 'Unknown'
            }]
          }
        };
      }

      // If submissionUid present, attach for UI polling
      if (result.status === 'success' && result.data?.submissionUid) {
        result.submissionUid = result.data.submissionUid;
      }


      return result;
    } catch (error) {
      // Improved error logging

      // Handle network errors and timeouts with structured responses
      if (error.message && (
        error.message.includes('ENETDOWN') ||
        error.message.includes('ECONNRESET') ||
        error.message.includes('ETIMEDOUT') ||
        error.message.includes('EHOSTUNREACH') ||
        error.message.includes('ECONNREFUSED') ||
        error.message.includes('ENOTFOUND')
      )) {
        return { status: 'failed', error: { code: 'NETWORK_ERROR', message: 'Network error while connecting to LHDN. Please check your internet connection.', details: [{ code: 'NETWORK_ERROR', message: `Network communication error: ${error.message}`, target: docs[0]?.codeNumber || 'Unknown' }] } };
      }

      if (error.message && error.message.includes('timeout')) {
        return { status: 'failed', error: { code: 'TIMEOUT', message: 'The connection to LHDN timed out. Please try again later.', details: [{ code: 'TIMEOUT', message: 'Request timed out while waiting for LHDN response. The server might be busy.', target: docs[0]?.codeNumber || 'Unknown' }] } };
      }

      return { status: 'failed', error: { code: error.response?.data?.code || 'SUBMISSION_FAILED', message: error.response?.data?.message || error.message || 'Failed to submit document to LHDN', details: error.response?.data?.error?.details || error.response?.data?.details || [{ code: 'SUBMISSION_FAILED', message: error.message || 'An error occurred during submission.', target: docs[0]?.codeNumber || 'Unknown' }] } };

      console.error('Error submitting document:', {
        message: error.message,
        code: error.response?.data?.code,
        details: error.response?.data?.error?.details || error.response?.data?.details,
        fullError: JSON.stringify(error.response?.data, null, 2)
      });

      // Handle network errors specifically
      if (error.message && (
          error.message.includes('timeout') ||
          error.message.includes('network') ||
          error.message.includes('ETIMEDOUT') ||
          error.message.includes('ECONNREFUSED') ||
          error.message.includes('ENOTFOUND'))) {
        return {
          status: 'failed',
          error: {
            code: 'NETWORK_ERROR',
            message: 'Network error while connecting to LHDN. Please check your internet connection.',
            details: [{
              code: 'NETWORK_ERROR',
              message: `Network communication error: ${error.message}`,
              target: docs[0]?.codeNumber || 'Unknown'
            }]
          }
        };
      }

      // Handle timeout separately
      if (error.code === 'ECONNABORTED' || (error.message && error.message.includes('timeout'))) {
        return {
          status: 'failed',
          error: {
            code: 'TIMEOUT',
            message: 'The connection to LHDN timed out. Please try again later.',
            details: [{
              code: 'TIMEOUT',
              message: 'Request timed out while waiting for LHDN response. The server might be busy.',
              target: docs[0]?.codeNumber || 'Unknown'
            }]
          }
        };
      }

      return {
        status: 'failed',
        error: {
          code: error.response?.data?.code || 'SUBMISSION_ERROR',
          message: error.message || 'Failed to submit document to LHDN',
          details: error.response?.data?.error?.details || error.response?.data?.details || [{
            code: 'UNKNOWN_ERROR',
            message: error.message || 'An unknown error occurred during submission',
            target: docs[0]?.codeNumber || 'Unknown'
          }]
        }
      };
    }
  }

  /**
   * Parse property path to determine field and location information in user-friendly language
   * @param {string} propertyPath - The property path from LHDN validation error
   * @param {string} originalMessage - The original error message for additional context
   * @returns {Object} Field and location information in plain English
   */
  parsePropertyPath(propertyPath, originalMessage = '') {
    if (!propertyPath && !originalMessage) {
      return {
        field: 'document information',
        location: 'your invoice',
        friendlyDescription: 'There is an issue with your invoice document'
      };
    }

    // Check the original message for additional context
    const messageText = originalMessage.toLowerCase();

    // Convert technical paths to user-friendly descriptions
    const pathMappings = {
      // Address and country code patterns
      'Invoice.AccountingSupplierParty.Party.PostalAddress.Country.IdentificationCode': {


        field: 'country code',
        location: 'supplier address section',
        friendlyDescription: 'The country code is missing from your supplier address'
      },
      'Invoice.AccountingCustomerParty.Party.PostalAddress.Country.IdentificationCode': {
        field: 'country code',
        location: 'customer address section',
        friendlyDescription: 'The country code is missing from your customer address'
      },
      'Invoice.Delivery.DeliveryParty.PostalAddress.Country.IdentificationCode': {
        field: 'country code',
        location: 'delivery address section',
        friendlyDescription: 'The country code is missing from your delivery address'
      },

      // Contact information patterns
      'Invoice.AccountingSupplierParty.Party.Contact.Telephone': {
        field: 'phone number',
        location: 'supplier contact information',
        friendlyDescription: 'There is an issue with the supplier phone number format'
      },
      'Invoice.AccountingCustomerParty.Party.Contact.Telephone': {
        field: 'phone number',
        location: 'customer contact information',
        friendlyDescription: 'There is an issue with the customer phone number format'
      },

      // Tax and identification patterns
      'Invoice.AccountingSupplierParty.Party.PartyIdentification.ID': {
        field: 'identification number',
        location: 'supplier information',
        friendlyDescription: 'There is an issue with the supplier identification number'
      },
      'Invoice.AccountingCustomerParty.Party.PartyIdentification.ID': {
        field: 'identification number',
        location: 'customer information',
        friendlyDescription: 'There is an issue with the customer identification number'
      }
    };

    // Check for exact match first
    if (pathMappings[propertyPath]) {
      return pathMappings[propertyPath];
    }

    // Check for pattern matches using regex for user-friendly descriptions
    if (propertyPath.includes('PostalAddress.Country.IdentificationCode')) {
      if (propertyPath.includes('AccountingSupplierParty')) {
        return {
          field: 'country code',
          location: 'supplier address section',
          friendlyDescription: 'The country code is missing from your supplier address'
        };
      } else if (propertyPath.includes('AccountingCustomerParty')) {
        return {
          field: 'country code',
          location: 'customer address section',
          friendlyDescription: 'The country code is missing from your customer address'
        };
      } else if (propertyPath.includes('Delivery')) {
        return {
          field: 'country code',
          location: 'delivery address section',
          friendlyDescription: 'The country code is missing from your delivery address'
        };
      }
    }

    if (propertyPath.includes('Item.OriginCountry.IdentificationCode')) {
      const lineMatch = propertyPath.match(/InvoiceLine\[(\d+)\]/);
      const lineNumber = lineMatch ? parseInt(lineMatch[1]) + 1 : '';
      const itemDescription = lineNumber ? `item ${lineNumber}` : 'one of your invoice items';

      return {
        field: 'origin country code',
        location: `invoice ${itemDescription}`,
        friendlyDescription: `The origin country code is missing for ${itemDescription}`
      };
    }

    if (propertyPath.includes('Contact.Telephone')) {
      if (propertyPath.includes('AccountingSupplierParty')) {
        return {
          field: 'phone number',
          location: 'supplier contact information',
          friendlyDescription: 'There is an issue with the supplier phone number format'
        };
      } else if (propertyPath.includes('AccountingCustomerParty')) {
        return {
          field: 'phone number',
          location: 'customer contact information',
          friendlyDescription: 'There is an issue with the customer phone number format'
        };
      }
    }

    // Check original message for context when propertyPath is not specific enough
    if (messageText.includes('propertyrequired') && messageText.includes('identificationcode')) {
      if (messageText.includes('country')) {
        if (messageText.includes('accountingsupplierparty')) {
          return {
            field: 'country code',
            location: 'supplier address section',
            friendlyDescription: 'The country code is missing from your supplier address'
          };
        } else if (messageText.includes('accountingcustomerparty')) {
          return {
            field: 'country code',
            location: 'customer address section',
            friendlyDescription: 'The country code is missing from your customer address'
          };
        } else {
          return {
            field: 'country code',
            location: 'address section',
            friendlyDescription: 'A required country code is missing from your invoice'
          };
        }
      }
    }

    // Fallback: create user-friendly descriptions from technical paths
    let field = 'information';
    let location = 'your invoice';
    let friendlyDescription = 'There is an issue with your invoice information';

    // Check for specific field types first
    if (propertyPath.includes('unitCode') || messageText.includes('unitcode')) {
      field = 'unit code';
      location = 'invoice items section';
      friendlyDescription = 'The unit code is missing from one of your invoice items';
    } else if (propertyPath.includes('InvoicedQuantity') || messageText.includes('invoicedquantity')) {
      field = 'quantity';
      location = 'invoice items section';
      friendlyDescription = 'The quantity information is missing or invalid for one of your invoice items';
    } else if (propertyPath.includes('LineExtensionAmount') || messageText.includes('lineextensionamount')) {
      field = 'line amount';
      location = 'invoice items section';
      friendlyDescription = 'The line amount is missing or invalid for one of your invoice items';
    } else if (propertyPath.includes('TaxAmount') || messageText.includes('taxamount')) {
      field = 'tax amount';
      location = 'tax information section';
      friendlyDescription = 'The tax amount is missing or invalid';
    } else if (propertyPath.includes('TaxableAmount') || messageText.includes('taxableamount')) {
      field = 'taxable amount';
      location = 'tax information section';
      friendlyDescription = 'The taxable amount is missing or invalid';
    } else if (propertyPath.includes('Percent') || messageText.includes('percent')) {
      field = 'tax percentage';
      location = 'tax information section';
      friendlyDescription = 'The tax percentage is missing or invalid';
    } else if (propertyPath.includes('AccountingSupplierParty') || messageText.includes('accountingsupplierparty')) {
      location = 'supplier information section';
      friendlyDescription = 'There is an issue with your supplier information';
    } else if (propertyPath.includes('AccountingCustomerParty') || messageText.includes('accountingcustomerparty')) {
      location = 'customer information section';
      friendlyDescription = 'There is an issue with your customer information';
    } else if (propertyPath.includes('InvoiceLine') || messageText.includes('invoiceline')) {
      location = 'invoice items section';
      friendlyDescription = 'There is an issue with one of your invoice items';
    } else if (propertyPath.includes('Delivery') || messageText.includes('delivery')) {
      location = 'delivery information section';
      friendlyDescription = 'There is an issue with your delivery information';
    }

    return { field, location, friendlyDescription };
  }

  /**
   * Generate user-friendly message and guidance in natural language
   * @param {string} propertyPath - The property path from LHDN validation error
   * @param {string} originalMessage - The original error message for additional context
   * @returns {Object} User-friendly message and guidance in plain English
   */
  generateUserFriendlyMessage(propertyPath, originalMessage = '') {
    // Check the original message for additional context
    const messageText = originalMessage.toLowerCase();

    // Unit code validation errors - specific handling for missing unit codes
    if ((propertyPath && propertyPath.includes('unitCode')) || messageText.includes('unitcode')) {
      return {
        userMessage: 'The unit code is missing from one of your invoice items.',
        guidance: [
          'Please add a unit code to your invoice item (e.g., "C62" for pieces, "KGM" for kilograms).',
          'Common unit codes: C62 (pieces), KGM (kilograms), MTR (meters), LTR (liters).',
          'The unit code must match the quantity type you are selling.',
          'You can find this field in the invoice items section next to the quantity.'
        ]
      };
    }

    // Quantity validation errors
    if ((propertyPath && propertyPath.includes('InvoicedQuantity')) || messageText.includes('invoicedquantity')) {
      return {
        userMessage: 'The quantity information is missing or invalid for one of your invoice items.',
        guidance: [
          'Please enter a valid quantity for your invoice item.',
          'The quantity must be a positive number.',
          'Make sure both the quantity value and unit code are provided.',
          'You can find this field in the invoice items section.'
        ]
      };
    }

    // Line amount validation errors
    if ((propertyPath && propertyPath.includes('LineExtensionAmount')) || messageText.includes('lineextensionamount')) {
      return {
        userMessage: 'The line amount is missing or invalid for one of your invoice items.',
        guidance: [
          'Please enter a valid line amount for your invoice item.',
          'The line amount should be the total before tax for this item.',
          'Make sure the amount is a positive number with proper decimal formatting.',
          'You can find this field in the invoice items section.'
        ]
      };
    }

    // Tax amount validation errors
    if ((propertyPath && propertyPath.includes('TaxAmount')) || messageText.includes('taxamount')) {
      return {
        userMessage: 'The tax amount is missing or invalid.',
        guidance: [
          'Please enter a valid tax amount.',
          'The tax amount should match the calculated tax for your items.',
          'Make sure the amount is properly formatted with decimals.',
          'You can find this field in the tax information section.'
        ]
      };
    }

    // Country code validation errors - check both propertyPath and originalMessage
    if ((propertyPath && propertyPath.includes('Country.IdentificationCode')) ||
        (messageText.includes('country') && messageText.includes('identificationcode'))) {

      if ((propertyPath && propertyPath.includes('AccountingSupplierParty')) ||
          messageText.includes('accountingsupplierparty')) {
        return {
          userMessage: 'Your supplier address is missing a country code.',
          guidance: [
            'Please add the country code to your supplier address.',
            'For Malaysian addresses, use "MY" as the country code.',
            'Make sure the country code field is not left blank.',
            'You can find this field in the supplier address section of your invoice.'
          ]
        };
      } else if ((propertyPath && propertyPath.includes('AccountingCustomerParty')) ||
                 messageText.includes('accountingcustomerparty')) {
        return {
          userMessage: 'Your customer address is missing a country code.',
          guidance: [
            'Please add the country code to your customer address.',
            'For Malaysian addresses, use "MY" as the country code.',
            'Make sure the country code field is not left blank.',
            'You can find this field in the customer address section of your invoice.'
          ]
        };
      } else if ((propertyPath && propertyPath.includes('Delivery')) ||
                 messageText.includes('delivery')) {
        return {
          userMessage: 'Your delivery address is missing a country code.',
          guidance: [
            'Please add the country code to your delivery address.',
            'For Malaysian addresses, use "MY" as the country code.',
            'Make sure the country code field is not left blank.',
            'You can find this field in the delivery address section of your invoice.'
          ]
        };
      } else {
        // Generic country code error
        return {
          userMessage: 'A country code is missing from one of your addresses.',
          guidance: [
            'Please check all address sections in your invoice.',
            'For Malaysian addresses, use "MY" as the country code.',
            'Make sure all country code fields are not left blank.',
            'Check supplier, customer, and delivery address sections.'
          ]
        };
      }
    }

    // Origin country code validation errors
    if ((propertyPath && propertyPath.includes('Item.OriginCountry.IdentificationCode')) ||
        (messageText.includes('origincountry') && messageText.includes('identificationcode'))) {
      const lineMatch = propertyPath ? propertyPath.match(/InvoiceLine\[(\d+)\]/) : null;
      const lineNumber = lineMatch ? parseInt(lineMatch[1]) + 1 : '';
      const itemReference = lineNumber ? `item number ${lineNumber}` : 'one of your invoice items';

      return {
        userMessage: `The origin country code is missing for ${itemReference}.`,
        guidance: [
          `Please add the origin country code for ${itemReference}.`,
          'For items made in Malaysia, use "MY" as the origin country code.',
          'Make sure all items in your invoice have their origin country specified.',
          'You can find this information in the item details section of your invoice.'
        ]
      };
    }

    // Phone number validation errors
    if ((propertyPath && propertyPath.includes('Contact.Telephone')) ||
        (messageText.includes('contact') && messageText.includes('telephone'))) {
      const contactType = (propertyPath && propertyPath.includes('AccountingSupplierParty')) ||
                         messageText.includes('accountingsupplierparty') ? 'supplier' : 'customer';

      return {
        userMessage: `The ${contactType} phone number format is incorrect.`,
        guidance: [
          `Please update the ${contactType} phone number to include the country code.`,
          'For Malaysian phone numbers, use this format: +60123456789',
          'Make sure the phone number starts with a plus sign (+).',
          `You can find this field in the ${contactType} contact section of your invoice.`
        ]
      };
    }

    // Identification number validation errors
    if ((propertyPath && propertyPath.includes('PartyIdentification.ID')) ||
        (messageText.includes('partyidentification') && messageText.includes('id'))) {
      const partyType = (propertyPath && propertyPath.includes('AccountingSupplierParty')) ||
                       messageText.includes('accountingsupplierparty') ? 'supplier' : 'customer';

      return {
        userMessage: `There is an issue with the ${partyType} identification number.`,
        guidance: [
          `Please check that the ${partyType} TIN or business registration number is correct.`,
          'Make sure the identification number format follows LHDN requirements.',
          'Remove any extra spaces or special characters from the number.',
          'Verify that this number is properly registered with LHDN.'
        ]
      };
    }

    // Check for PropertyRequired errors in the original message
    if (messageText.includes('propertyrequired')) {
      if (messageText.includes('identificationcode')) {
        if (messageText.includes('country')) {
          return {
            userMessage: 'A required country code is missing from your invoice.',
            guidance: [
              'Please check all address sections in your invoice.',
              'For Malaysian addresses, use "MY" as the country code.',
              'Make sure all country code fields are filled in.',
              'Check supplier, customer, and delivery address sections.'
            ]
          };
        }
      }
    }

    // Generic validation error fallback
    return {
      userMessage: 'There is an issue with your invoice that needs to be corrected.',
      guidance: [
        'Please review your invoice information for accuracy.',
        'Make sure all required fields are filled in completely.',
        'Check that all data follows the correct format requirements.',
        'Ensure all mandatory information has been provided.'
      ]
    };
  }

  async updateSubmissionStatus(data, transaction = null) {
    try {
      const submissionData = {
        invoice_number: data.invoice_number,
        UUID: data.uuid || 'NA',
        submissionUid: data.submissionUid || 'NA',
        fileName: data.fileName,
        filePath: data.filePath,
        status: data.status,
        date_submitted: new Date(),
        created_at: new Date(),
        updated_at: new Date()
      };

      await prisma.wP_OUTBOUND_STATUS.upsert({
        where: { filePath: data.filePath },
        update: submissionData,
        create: submissionData
      });

      await this.logOperation(`Status Updated to ${data.status} for invoice ${data.invoice_number}`, {
        action: 'STATUS_UPDATE',
        status: data.status
      });

    } catch (error) {
      console.error('Error updating submission status:', error);
      throw error;
    }
  }

  extractInvoiceTypeCode(fileName) {
    const match = fileName.match(/^(\d{2})_/);
    return match ? match[1] : null;
  }

  async updateExcelWithResponse(fileName, type, company, date, uuid, invoice_number) {
    try {
      console.log('=== updateExcelWithResponse Start ===');
      console.log('Input Parameters:', { fileName, type, company, date, uuid, invoice_number });

      // Get network path from config
      const config = await getActiveSAPConfig();
      console.log('SAP Config:', config);

      if (!config.success) {
        throw new Error('Failed to get SAP configuration');
      }

      // Format date properly for folder structure
      const formattedDate = moment(date).format('YYYY-MM-DD');

      // Construct base paths for outgoing files
      const outgoingBasePath = path.join('C:\\SFTPRoot\\Outgoing', type, company, formattedDate);
      const outgoingFilePath = path.join(outgoingBasePath, fileName);

      // Generate JSON file in the same folder as Excel
      const baseFileName = fileName.replace('.xls', '');
      const jsonFileName = `${baseFileName}.json`;
      const jsonFilePath = path.join(outgoingBasePath, jsonFileName);

      console.log('File Paths:', {
        outgoingBasePath,
        outgoingFilePath,
        jsonFilePath
      });

      // Create directory structure recursively
      await fsPromises.mkdir(outgoingBasePath, { recursive: true });

      // Construct incoming file path
      const incomingPath = path.join(config.networkPath, type, company, formattedDate, fileName);

      console.log('File Paths:', {
        incomingPath,
        outgoingFilePath
      });

      // Read source Excel file
      const workbook = XLSX.readFile(incomingPath);
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];

      // Find header row and update UUID and invoice_number
      const range = XLSX.utils.decode_range(worksheet['!ref']);
      for (let R = range.s.r; R <= range.e.r; ++R) {
        const typeCell = XLSX.utils.encode_cell({ r: R, c: 0 });
        if (worksheet[typeCell] && worksheet[typeCell].v === 'H') {
          const uuidCell = XLSX.utils.encode_cell({ r: R, c: 2 });
          worksheet[uuidCell] = { t: 's', v: uuid };
          const invoiceCell = XLSX.utils.encode_cell({ r: R, c: 3 });
          worksheet[invoiceCell] = { t: 's', v: invoice_number };
          break;
        }
      }

      // Write updated Excel file
      XLSX.writeFile(workbook, outgoingFilePath);

      // Get processed data
      const processedData = await this.getProcessedData(fileName, type, company, date);
      console.log('Processed Data:', processedData);

      // Get config for version
      const lhdnConfig = await prisma.wP_CONFIGURATION.findFirst({
        where: {
          Type: 'LHDN',
          IsActive: true
        }
      });

      const lhdnSettings = lhdnConfig?.Settings ?
        (typeof lhdnConfig.Settings === 'string' ?
          JSON.parse(lhdnConfig.Settings) :
          lhdnConfig.Settings) : {};

      // Create JSON content with simplified structure
      const jsonContent = {
        "issueDate": moment(date).format('YYYY-MM-DD'),
        "issueTime": new Date().toISOString().split('T')[1].split('.')[0] + 'Z',
        "invoiceTypeCode": processedData.invoiceType || processedData.header?.invoiceType || "01",
        "invoiceNo": invoice_number,
        "uuid": uuid,
      };
      // Write JSON file
      await fsPromises.writeFile(jsonFilePath, JSON.stringify(jsonContent, null, 2));

      const response = {
        success: true,
        outgoingPath: outgoingFilePath,
        jsonPath: jsonFilePath
      };

      console.log('=== updateExcelWithResponse Response ===', response);
      return response;

    } catch (error) {
      console.error('=== updateExcelWithResponse Error ===', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  async updateExcelWithResponseConsolidated(fileName, type, company, date, uuid, invoice_number) {
    try {
      console.log('=== updateExcelWithResponseConsolidated Start ===');
      console.log('Input Parameters:', { fileName, type, company, date, uuid, invoice_number });

      // Get network path from config
      const config = await getActiveSAPConfig();
      console.log('SAP Config:', config);

      if (!config.success) {
        throw new Error('Failed to get SAP configuration');
      }

      // Format date properly for folder structure
      const formattedDate = moment(date).format('YYYY-MM-DD');

      // Construct base paths for outgoing files
      const outgoingBasePath = path.join('C:\\SFTPRoot_Consolidation', 'Outgoing', company, formattedDate);
      const outgoingFilePath = path.join(outgoingBasePath, fileName);

      // Generate JSON file in the same folder as Excel
      const baseFileName = fileName.replace('.xls', '');
      const jsonFileName = `${baseFileName}.json`;
      const jsonFilePath = path.join(outgoingBasePath, jsonFileName);

      console.log('File Paths:', {
        outgoingBasePath,
        outgoingFilePath,
        jsonFilePath
      });

      // Create directory structure recursively
      await fsPromises.mkdir(outgoingBasePath, { recursive: true });

      // Construct incoming file path
      const incomingPath = path.join('C:\\SFTPRoot_Consolidation', 'Incoming', company, formattedDate, fileName);

      console.log('File Paths:', {
        incomingPath,
        outgoingFilePath
      });

      // Read source Excel file
      const workbook = XLSX.readFile(incomingPath);
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];

      // Find header row and update UUID and invoice_number
      const range = XLSX.utils.decode_range(worksheet['!ref']);
      for (let R = range.s.r; R <= range.e.r; ++R) {
        const typeCell = XLSX.utils.encode_cell({ r: R, c: 0 });
        if (worksheet[typeCell] && worksheet[typeCell].v === 'H') {
          const uuidCell = XLSX.utils.encode_cell({ r: R, c: 2 });
          worksheet[uuidCell] = { t: 's', v: uuid };
          const invoiceCell = XLSX.utils.encode_cell({ r: R, c: 3 });
          worksheet[invoiceCell] = { t: 's', v: invoice_number };
          break;
        }
      }

      // Write updated Excel file
      XLSX.writeFile(workbook, outgoingFilePath);

      // Get processed data for consolidated files
      const processedData = await this.getProcessedDataConsolidated(fileName, type, company, date);
      console.log('Processed Data:', processedData);

      // Get config for version
      const lhdnConfig = await prisma.wP_CONFIGURATION.findFirst({
        where: {
          Type: 'LHDN',
          IsActive: true
        }
      });

      const lhdnSettings = lhdnConfig?.Settings ?
        (typeof lhdnConfig.Settings === 'string' ?
          JSON.parse(lhdnConfig.Settings) :
          lhdnConfig.Settings) : {};

      // Create JSON content with simplified structure
      const jsonContent = {
        "issueDate": moment(date).format('YYYY-MM-DD'),
        "issueTime": new Date().toISOString().split('T')[1].split('.')[0] + 'Z',
        "invoiceTypeCode": processedData.invoiceType || processedData.header?.invoiceType || "01",
        "invoiceNo": invoice_number,
        "uuid": uuid,
      };
      // Write JSON file
      await fsPromises.writeFile(jsonFilePath, JSON.stringify(jsonContent, null, 2));

      const response = {
        success: true,
        outgoingPath: outgoingFilePath,
        jsonPath: jsonFilePath
      };

      console.log('=== updateExcelWithResponse Response ===', response);
      return response;

    } catch (error) {
      console.error('=== updateExcelWithResponse Error ===', error);
      return {
        success: false,
        error: error.message
      };
    }
  }


  // Retrieve submission status from LHDN and normalize for pollers
  async getSubmissionDetails(submissionUid, token) {
    try {
      if (!submissionUid) return { success: false, message: 'Missing submissionUid' };
      const { getSubmission } = require('./lhdnService');
      const auth = token || (this.req?.session?.accessToken);
      const resp = await getSubmission(submissionUid, auth);
      if (resp?.status !== 'success') {
        return { success: false, message: 'GetSubmission failed' };
      }
      const data = resp.data || {};
      const overallRaw = data.overallStatus || data.status || '';
      const overall = String(overallRaw).toLowerCase();
      const result = Array.isArray(data.result) ? data.result : (Array.isArray(data.documents) ? data.documents : []);
      const first = result[0] || {};
      return {
        success: true,
        status: overall || 'in progress',
        inProgress: overall.includes('progress') || overall === 'processing',
        details: data,
        documentDetails: first,
        longId: first.longId || first.internalId || null
      };
    } catch (e) {
      return { success: false, message: e?.message || 'GetSubmission error' };
    }
  }

}

module.exports = LHDNSubmitter;