const fs = require('fs');
const path = require('path');
const { logRawToJson, logLhdnMapping } = require('./excelLogger');
const { mapToLHDNFormat } = require('./lhdnMapper');

/**
 * Constants for Excel field mapping and default values
 */
// Define possible Excel column name prefixes for field mapping
const EXCEL_FIELD_PREFIXES = [
  '__EMPTY_',  // Original format with double underscore EMPTY first
  '',         // Direct field name (e.g. "Invoice")
  '_',        // Alternative format with single underscore
  'EMPTY_',   // Another possible format
  '__',       // Double underscore without EMPTY
  'Column',   // Column prefix format
  'Field',    // Field prefix format
  'col',      // col prefix format
  'field'     // field prefix format
];

// Define row type indicators - now only H (Header) rows are processed
// Each H row contains complete invoice data (header + line items + footer)
const ROW_TYPE_INDICATORS = {
  HEADER: {
    type: 'H',
    identifiers: ['Invoice', 'InvoiceNumber', 'DocumentNumber']
  },
  // Note: L and F types are kept for compatibility but are no longer processed separately
  LINE: {
    type: 'L',
    identifiers: ['InvoiceLine', 'LineNumber', 'ItemNumber']
  },
  FOOTER: {
    type: 'F',
    identifiers: ['LegalMonetaryTotal', 'TotalAmount', 'Invoice_TaxTotal']
  }
};

// Define party identification scheme types for tax and business registration
const PARTY_SCHEME_TYPES = {
  TIN: 'TIN', // Tax Identification Number
  BRN: 'BRN', // Business Registration Number
  SST: 'SST', // Sales and Service Tax
  TTX: 'TTX'  // Tax Registration Number
};

// Malaysian state code mapping
const MALAYSIAN_STATES = {
  1: 'Johor',
  2: 'Kedah',
  3: 'Kelantan',
  4: 'Melaka',
  5: 'Negeri Sembilan',
  6: 'Pahang',
  7: 'Perak',
  8: 'Perlis',
  9: 'Pulau Pinang',
  10: 'Sabah',
  11: 'Sarawak',
  12: 'Selangor',
  13: 'Terengganu',
  14: 'Wilayah Persekutuan Kuala Lumpur',
  15: 'Wilayah Persekutuan Labuan',
  16: 'Wilayah Persekutuan Putrajaya',
  17: 'Not Applicable'
};

/**
 * Main function to process Excel data and convert it to e-Invoice format
 * @param {Array} rawData - Raw Excel data array where:
 *   - rawData[0] = Descriptions row
 *   - rawData[1] = Field mappings row
 *   - rawData[2+] = Actual data rows
 * @returns {Array} Array of processed invoice documents
 */
const processManualUploadExcelData = (rawData) => {
    // Setup logger for tracking processing
    const logger = {
      info: (msg, data) => console.log(`[INFO] ${msg}`, data || ''),
      error: (msg, data) => console.error(`[ERROR] ${msg}`, data || '')
    };

    /**
     * Helper function to map Malaysian state codes to state names
     * @param {any} stateCode - State code (number or string)
     * @returns {string} State name or original value if not found
     */
    const mapStateCode = (stateCode) => {
      if (!stateCode) return "NA";

      const code = parseInt(stateCode);
      if (isNaN(code)) return String(stateCode); // Return as-is if not a number

      return MALAYSIAN_STATES[code] || String(stateCode);
    };

    /**
     * Helper function to convert Excel serial date to ISO date string
     * Excel stores dates as serial numbers (days since 1900-01-01)
     * @param {any} excelDate - Excel serial date number or date string
     * @returns {string} ISO date string (YYYY-MM-DD) or original value if not a valid date
     */
    const convertExcelDate = (excelDate) => {
      if (!excelDate) return '';

      // If it's already a string that looks like a date, return as-is
      if (typeof excelDate === 'string' && excelDate.includes('-')) {
        return excelDate;
      }

      // If it's a number (Excel serial date)
      const dateNum = parseFloat(excelDate);
      if (!isNaN(dateNum) && dateNum > 0) {
        // Excel epoch starts at 1900-01-01, but Excel incorrectly treats 1900 as a leap year
        // So we need to subtract 1 day for dates after 1900-02-28
        const excelEpoch = new Date(1900, 0, 1); // January 1, 1900
        const millisecondsPerDay = 24 * 60 * 60 * 1000;

        // Adjust for Excel's leap year bug
        const adjustedDays = dateNum > 59 ? dateNum - 2 : dateNum - 1;
        const resultDate = new Date(excelEpoch.getTime() + (adjustedDays * millisecondsPerDay));

        // Return in YYYY-MM-DD format
        return resultDate.toISOString().split('T')[0];
      }

      // If it's not a valid number, return as string
      return String(excelDate);
    };

    /**
     * Helper function to get field value with support for different Excel column formats
     * Tries multiple format variations to find the correct field value
     * @param {Object} row - Excel row data
     * @param {string} baseField - Base field name to look for
     * @returns {any} Field value if found, undefined otherwise
     */
    const getField = (row, baseField) => {
      // Try different field name formats in order of preference
      const fieldFormats = EXCEL_FIELD_PREFIXES.map(prefix => `${prefix}${baseField}`);

      // First try exact matches
      for (const field of fieldFormats) {
        if (row[field] !== undefined) {
          return row[field];
        }
      }

      // If no exact match found, try case-insensitive matches
      const lowerBaseField = baseField.toLowerCase();
      for (const key of Object.keys(row)) {
        if (key.toLowerCase() === lowerBaseField ||
            EXCEL_FIELD_PREFIXES.some(prefix =>
              key.toLowerCase() === `${prefix.toLowerCase()}${lowerBaseField}`)) {
          return row[key];
        }
      }

      // If no match found, try numeric index fields
      const numericField = baseField.match(/^_(\d+)$/);
      if (numericField) {
        const index = numericField[1];
        const alternateFormats = EXCEL_FIELD_PREFIXES.map(prefix => `${prefix}${index}`);

        for (const format of alternateFormats) {
          if (row[format] !== undefined) {
            return row[format];
          }
        }
      }

      return undefined;
    };

    /**
     * Helper function to determine if a row contains invoice data
     * New structure: Rows with valid invoice numbers in the Invoice column are invoice documents
     * @param {Object} row - Excel row data
     * @returns {string|null} 'INVOICE' if valid invoice row, null otherwise
     */
    const getRowType = (row) => {
      // NEW STRUCTURE: Check if row has a valid invoice number in the Invoice column
      if (row && row.Invoice) {
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
            return 'INVOICE';
          }
        }
      }

      // LEGACY SUPPORT: Check traditional __EMPTY field for backward compatibility
      const legacyRowType = row[''] || row['__EMPTY'] || row['_'] ||
                           row['RowType'] || row['Type'] || row['Row_Type'] ||
                           row['Row Type'] || row['RowIdentifier'] || row['Row Identifier'] ||
                           null;

      if (legacyRowType && row) {
        // Check if this looks like a specific row type using the indicators
        for (const config of Object.values(ROW_TYPE_INDICATORS)) {
          if (config.identifiers.some(id => row[id])) {
            return config.type;
          }
        }
      }

      return legacyRowType;
    };

    /**
     * Process flow:
     * 1. Initialize log buffers for tracking processing steps
     * 2. Extract descriptions, field mappings, and data rows from raw data
     * 3. Process each row to create invoice documents
     */
    let processLogs = {
      steps: [],
      identifications: [],
      documents: [],
      mappingResults: []
    };

    // Helper function to add to process log
    const addToProcessLog = (data, type) => {
      processLogs[type] = processLogs[type] || [];
      processLogs[type].push({
        timestamp: new Date().toISOString(),
        data
      });
    };

    try {
      // Log processing steps
      const logStep = (step, data) => {
        processLogs.steps.push({
          timestamp: new Date().toISOString(),
          step,
          data
        });
      };

      // Extract structure rows and data rows for new format
      // New structure:
      // Row 0: Column headers (e.g., "Invoice", "Original eInvoice Unique Identifier Number", etc.)
      // Row 1: Field mappings (e.g., "Invoice_ID", etc.)
      // Row 2+: Actual invoice data (e.g., "2250041811", "2250041812", etc.)

      const columnHeaders = rawData[0];     // Row 0: Column headers
      const fieldMappings = rawData[1];     // Row 1: Field mappings
      const dataRows = rawData.slice(2);    // Row 2+: Actual invoice data

      // Log initial data structure
      logStep('Initial Data - New Structure', {
        totalRows: dataRows.length,
        columnHeaders,
        fieldMappings,
        firstDataRow: dataRows[0],
        sampleInvoiceNumbers: dataRows.slice(0, 5).map(row => row.Invoice).filter(Boolean)
      });

      /**
       * Document Processing:
       * Each H row creates a complete document, no need to track current document
       */
      const documents = [];

      /**
       * Helper function to process party identifications
       * Extracts and validates identification information for parties
       * @param {Array} rows - Array of rows containing identification data
       * @returns {Array} Processed identifications
       */
      const getIdentifications = (rows) => {
        const identifications = [];

        logStep('Processing Identifications', {
          inputRows: rows
        });

        if (rows && rows.length > 0) {
          rows.forEach((row) => {
            // Include identification even if PartyIdentification_ID is 'NA' for proper tracking
            if (row?.PartyIdentification_ID !== undefined && row?.PartyIdentification_ID !== null && row?.schemeId) {
              identifications.push({
                id: String(row.PartyIdentification_ID),
                schemeId: row.schemeId
              });
            }
          });
        }

        processLogs.identifications.push({
          input: rows,
          output: identifications,
          timestamp: new Date().toISOString()
        });

        return identifications;
      };

      /**
       * Creates a new invoice document from invoice row data
       * New structure: Processes all data (header, line items, footer) from a single invoice row
       * Each row with a valid invoice number contains complete invoice information
       * @param {Object} invoiceRow - Excel row containing complete invoice information
       * @param {Array} dataRows - All data rows (for compatibility)
       * @param {number} currentIndex - Current processing index (for compatibility)
       * @returns {Object} Processed invoice document
       */
      const createNewDocument = (invoiceRow, dataRows, currentIndex) => {
        // logRawExcelData(invoiceRow, dataRows, currentIndex);

        logStep('Creating New Document from Invoice Row', {
          invoiceRow,
          currentIndex,
          invoiceNumber: invoiceRow.Invoice
        });

        // Note: All data (header, line items, footer) is extracted from the same invoiceRow

        // Update scheme ID rows with consistent naming
        // Note: In new structure, all party identification data comes from the single invoice row
        // Get identification values with corrected field mappings based on raw data analysis
        // Based on the raw data: __EMPTY_15 = TIN, __EMPTY_16 = BRN, __EMPTY_20 = SST, __EMPTY_21 = TTX
        const supplierTIN = getField(invoiceRow, '15');  // __EMPTY_15 contains TIN (C4890799050)
        const supplierBRN = getField(invoiceRow, '16');  // __EMPTY_16 contains BRN (213588D)
        const supplierSST = getField(invoiceRow, '20') || 'NA'; // __EMPTY_20 contains SST
        const supplierTTX = getField(invoiceRow, '21') || 'NA'; // __EMPTY_21 contains TTX

        // Buyer fields: Buyer column = TIN, __EMPTY_34 = BRN, __EMPTY_38 = SST, __EMPTY_39 = TTX
        const buyerTIN = invoiceRow.Buyer;               // Buyer column contains TIN
        const buyerBRN = getField(invoiceRow, '34');     // __EMPTY_34 contains buyer BRN
        const buyerSST = getField(invoiceRow, '38') || 'NA'; // __EMPTY_38 contains SST
        const buyerTTX = getField(invoiceRow, '39') || 'NA'; // __EMPTY_39 contains TTX

        // Log identification values for debugging
        logStep('Extracted Identification Values', {
          supplier: {
            TIN: supplierTIN,
            BRN: supplierBRN,
            SST: supplierSST,
            TTX: supplierTTX,
            field15: getField(invoiceRow, '15'), // TIN field
            field16: getField(invoiceRow, '16'), // BRN field
            field20: getField(invoiceRow, '20'), // SST field
            field21: getField(invoiceRow, '21')  // TTX field
          },
          buyer: {
            TIN: buyerTIN,
            BRN: buyerBRN,
            SST: buyerSST,
            TTX: buyerTTX,
            field34: getField(invoiceRow, '34'), // BRN field
            buyerColumn: invoiceRow.Buyer,       // TIN field
            field38: getField(invoiceRow, '38'), // SST field
            field39: getField(invoiceRow, '39')  // TTX field
          }
        });

        // Log tax-related field values for debugging
        logStep('Extracted Tax Values', {
          taxTypeCode: getField(invoiceRow, '62'),
          taxCategoryId: getField(invoiceRow, '60'),
          taxExemptionReason: getField(invoiceRow, '81'),
          taxSchemeId: getField(invoiceRow, '61'),
          taxRate: getField(invoiceRow, '79'),
          taxAmount: getField(invoiceRow, 'Invoice_TaxTotal'),
          taxableAmount: getField(invoiceRow, '58'),
          taxExemptedAmount: getField(invoiceRow, '82')
        });

        // Log invoice period field values for debugging
        logStep('Extracted Invoice Period Values', {
          rawStartDate: invoiceRow.InvoicePeriod,
          rawEndDate: getField(invoiceRow, '8'),
          rawDescription: getField(invoiceRow, '9'),
          convertedStartDate: convertExcelDate(invoiceRow.InvoicePeriod),
          convertedEndDate: convertExcelDate(getField(invoiceRow, '8')),
          description: getField(invoiceRow, '9')
        });

        const partyIdentifications = {
          supplier: [
            {
              PartyIdentification_ID: supplierTIN, // TIN
              schemeId: PARTY_SCHEME_TYPES.TIN
            },
            {
              PartyIdentification_ID: supplierBRN, // BRN (Company ID)
              schemeId: PARTY_SCHEME_TYPES.BRN
            },
            {
              PartyIdentification_ID: supplierSST, // SST - separate field
              schemeId: PARTY_SCHEME_TYPES.SST
            },
            {
              PartyIdentification_ID: supplierTTX, // TTX - separate field
              schemeId: PARTY_SCHEME_TYPES.TTX
            }
          ],
          buyer: [
            {
              PartyIdentification_ID: buyerTIN, // Buyer TIN
              schemeId: PARTY_SCHEME_TYPES.TIN
            },
            {
              PartyIdentification_ID: buyerBRN, // Buyer ID
              schemeId: PARTY_SCHEME_TYPES.BRN
            },
            {
              PartyIdentification_ID: buyerSST, // SST - separate field
              schemeId: PARTY_SCHEME_TYPES.SST
            },
            {
              PartyIdentification_ID: buyerTTX, // TTX - separate field
              schemeId: PARTY_SCHEME_TYPES.TTX
            }
          ],
          delivery: [
            {
              PartyIdentification_ID: invoiceRow.Delivery || 'NA',
              schemeId: PARTY_SCHEME_TYPES.TIN
            },
            {
              PartyIdentification_ID: invoiceRow.Delivery || 'NA',
              schemeId: PARTY_SCHEME_TYPES.BRN
            },
            {
              PartyIdentification_ID: invoiceRow.Delivery || 'NA',
              schemeId: PARTY_SCHEME_TYPES.SST
            },
            {
              PartyIdentification_ID: invoiceRow.Delivery || 'NA',
              schemeId: PARTY_SCHEME_TYPES.TTX
            }
          ]
        };

        // Add detailed logging for document creation
        const documentLog = {
          timestamp: new Date().toISOString(),
          documentId: invoiceRow.Invoice,
          partyIdentifications
        };
        processLogs.documents.push(documentLog);

        const currentDate = new Date();
        const formattedDate = currentDate.toISOString().split('T')[0];
        const formattedTime = currentDate.toISOString().split('T')[1].split('.')[0] + 'Z';

        const doc = {
          header: {
            invoiceNo: invoiceRow.Invoice,
            invoiceType: getField(invoiceRow, '4'),
            documentCurrencyCode: getField(invoiceRow, '5'),
            //taxCurrencyCode: getField(invoiceRow, '6'),
            currency: getField(invoiceRow, '5'),
            taxCurrencyCode: getField(invoiceRow, '6') || getField(invoiceRow, '5'),
            exchangeRate: getField(invoiceRow, '7') || 0,
            invoiceDocumentReference:getField(invoiceRow, '0') || '',
            InvoiceDocumentReference_ID: getField(invoiceRow, '1') || '',
            documentReference: {
              uuid: getField(invoiceRow, '0') || '',
              internalId: getField(invoiceRow, '1') || '',
              billingReference: invoiceRow.AdditionalDocumentReference || DEFAULT_VALUES.NOT_APPLICABLE,
              billingReferenceType: getField(invoiceRow, '10') || DEFAULT_VALUES.NOT_APPLICABLE
            },
            issueDate: [{ _: formattedDate }],
            issueTime: [{ _: formattedTime }],
            invoicePeriod: {
              startDate: convertExcelDate(invoiceRow.InvoicePeriod) || '',
              endDate: convertExcelDate(getField(invoiceRow, '8')) || '',
              description: getField(invoiceRow, '9') || ''
            }
          },
          supplier: {
            id: getField(invoiceRow, '15'),  // Supplier TIN from __EMPTY_15
            additionalAccountID: invoiceRow.Supplier || DEFAULT_VALUES.NOT_APPLICABLE,
            schemeAgencyName: getField(invoiceRow, '12') || 'CertEx',
            industryClassificationCode: getField(invoiceRow, '13'),
            industryName: getField(invoiceRow, '14'),
            identifications: getIdentifications(partyIdentifications.supplier),
            name: getField(invoiceRow, '31'),
            address: {
              // Process address line with proper formatting - collect from multiple rows
              line: processAddressLine(null, invoiceRow, dataRows, currentIndex, '25'),
              city: getField(invoiceRow, '22') || "NA",
              postcode: getField(invoiceRow, '23') || "NA",
              state: mapStateCode(getField(invoiceRow, '24')) || "NA",
              country: getField(invoiceRow, '28') || "NA",
              countryListID: getField(invoiceRow, '29') || "NA",
              countryListAgencyID: getField(invoiceRow, '30')|| "NA"
            },
            contact: {
              phone: getField(invoiceRow, '32'),
              email: getField(invoiceRow, '33')
            }
          },
          buyer: {
            id: buyerTIN,
            identifications: getIdentifications(partyIdentifications.buyer),
            name: getField(invoiceRow, '49'),
            address: {
              // Process address line with proper formatting - collect from multiple rows
              line: processAddressLine(null, invoiceRow, dataRows, currentIndex, '43'),
              city: getField(invoiceRow, '40') || "NA",
              postcode: getField(invoiceRow, '41') || "NA",
              state: mapStateCode(getField(invoiceRow, '42')) || "NA",
              country: getField(invoiceRow, '46') || "NA",
              countryListID: getField(invoiceRow, '47') || DEFAULT_VALUES.COUNTRY_SCHEME.listId,
              countryListAgencyID: getField(invoiceRow, '48') || DEFAULT_VALUES.COUNTRY_SCHEME.agencyId
            },
            contact: {
              phone: getField(invoiceRow, '50'),
              email: getField(invoiceRow, '51')
            }
          },
          delivery: {
            id: invoiceRow.Delivery || DEFAULT_VALUES.NOT_APPLICABLE,
            identifications: getIdentifications(partyIdentifications.delivery),
            name: getField(invoiceRow, '67') || DEFAULT_VALUES.NOT_APPLICABLE, // __EMPTY_67 contains delivery name
            address: {
              // Delivery address fields - corrected mapping
              line: processAddressLine(null, invoiceRow, dataRows, currentIndex, '61'), // __EMPTY_61 for delivery address
              city: getField(invoiceRow, '58') || "NA",     // __EMPTY_58 for delivery city
              postcode: getField(invoiceRow, '59') || "NA", // __EMPTY_59 for delivery postcode
              state: mapStateCode(getField(invoiceRow, '60')) || "NA", // __EMPTY_60 for delivery state
              country: getField(invoiceRow, '64') || "MYS", // __EMPTY_64 for delivery country
              countryListID: getField(invoiceRow, '65') || "ISO3166-1", // __EMPTY_65 for delivery country list ID
              countryListAgencyID: String(getField(invoiceRow, '66') || "6") // __EMPTY_66 for delivery country list agency ID
            },
            shipment: {
              id: getField(invoiceRow, '68') || DEFAULT_VALUES.NOT_APPLICABLE, // __EMPTY_68 for shipment ID
              freightAllowanceCharge: {
                indicator: getField(invoiceRow, '69') === true ||
                          getField(invoiceRow, '69') === 'true' ||
                          getField(invoiceRow, '69') === 1 ||
                          getField(invoiceRow, '69') === '1',
                reason: getField(invoiceRow, '70') || DEFAULT_VALUES.NOT_APPLICABLE, // __EMPTY_70 for freight reason
                amount: parseFloat(getField(invoiceRow, '71')) || 0 // __EMPTY_71 for freight amount
              }
            }
          },
          payment: {
            paymentMeansCode: getField(invoiceRow, 'PaymentMeans') || '',
            payeeFinancialAccount: getField(invoiceRow, '72') || DEFAULT_VALUES.NOT_APPLICABLE, // __EMPTY_72 for payee financial account
            paymentTerms: getField(invoiceRow, 'PaymentTerms') || DEFAULT_VALUES.NOT_APPLICABLE,
            prepaidPayment: {
              id: getField(invoiceRow, 'PrepaidPayment') || DEFAULT_VALUES.NOT_APPLICABLE,
              amount: getField(invoiceRow, '73') || DEFAULT_VALUES.ZERO, // __EMPTY_73 for prepaid amount
              date: getField(invoiceRow, '74') || null,  // __EMPTY_74 for prepaid date
              time: getField(invoiceRow, '75') || null   // __EMPTY_75 for prepaid time
            }
          },
          items: [],
          summary: {
            amounts: {
              lineExtensionAmount: DEFAULT_VALUES.ZERO,
              taxExclusiveAmount: DEFAULT_VALUES.ZERO,
              taxInclusiveAmount: DEFAULT_VALUES.ZERO,
              allowanceTotalAmount: DEFAULT_VALUES.ZERO,
              chargeTotalAmount: DEFAULT_VALUES.ZERO,
              payableRoundingAmount: DEFAULT_VALUES.ZERO,
              payableAmount: DEFAULT_VALUES.ZERO
            },
            tax: {
              totalAmount: DEFAULT_VALUES.ZERO,
              taxableAmount: DEFAULT_VALUES.ZERO,
              taxExemptedAmount: DEFAULT_VALUES.ZERO,
              taxRate: DEFAULT_VALUES.ZERO,
              taxAmount: DEFAULT_VALUES.ZERO,
              taxTypeCode: getField(invoiceRow, '62') || DEFAULT_VALUES.NOT_APPLICABLE, // Tax Type Code from field 62
              taxExemptionReason: DEFAULT_VALUES.NOT_APPLICABLE,
              taxSubtotal: {
                taxableAmount: DEFAULT_VALUES.ZERO,
                taxAmount: DEFAULT_VALUES.ZERO
              },
              category: {
                id: getField(invoiceRow, '60') || DEFAULT_VALUES.NOT_APPLICABLE, // Tax Category ID from field 60
                exemptionReason: getField(invoiceRow, '81') || DEFAULT_VALUES.NOT_APPLICABLE, // Tax Exemption Reason from field 81
                scheme: DEFAULT_VALUES.TAX_SCHEME
              }
            }
          },
          allowanceCharge: {
            indicator: getField(invoiceRow, 'InvoiceAllowanceCharge') === true ||
                      getField(invoiceRow, 'InvoiceAllowanceCharge') === 'true' ||
                      getField(invoiceRow, 'InvoiceAllowanceCharge') === 1,
            reason: getField(invoiceRow, '76') || DEFAULT_VALUES.NOT_APPLICABLE, // __EMPTY_76 for allowance charge reason
            amount: getField(invoiceRow, '77') || DEFAULT_VALUES.ZERO // __EMPTY_77 for allowance charge amount
          }

        };

        // Process line items from the invoice row data
        // Log available fields for line item debugging
        logStep('Available Line Item Fields', {
          invoiceLineFields: Object.keys(invoiceRow).filter(key =>
            key.toLowerCase().includes('invoiceline') || key.toLowerCase().includes('line')
          ),
          quantityFields: Object.keys(invoiceRow).filter(key => key.includes('70')),
          amountFields: Object.keys(invoiceRow).filter(key => key.includes('72')),
          allNumericFields: Object.keys(invoiceRow).filter(key => /\d+/.test(key)).slice(0, 10) // First 10 numeric fields
        });

        const lineItem = {
          lineId: getField(invoiceRow, 'InvoiceLine'),
          quantity: getField(invoiceRow, '90'),
          unitCode: getField(invoiceRow, '91'),
          unitPrice: getField(invoiceRow, '108'),
          lineExtensionAmount: getField(invoiceRow, '92'),
          allowanceCharges: [{
            chargeIndicator: getField(invoiceRow, '93') === true ||
                            getField(invoiceRow, '93') === 'true' ||
                            getField(invoiceRow, '93') === 1,
            reason: getField(invoiceRow, '94') || 'NA',
            multiplierFactorNumeric: getField(invoiceRow, '95') || 0,
            amount: getField(invoiceRow, '96') || 0
          }],
          taxTotal: {
            taxAmount: getField(invoiceRow, 'InvoiceLine_TaxTotal') || DEFAULT_VALUES.ZERO,
            taxSubtotal: [{
              taxableAmount: getField(invoiceRow, '97') || DEFAULT_VALUES.ZERO,
              taxAmount: getField(invoiceRow, '98') || DEFAULT_VALUES.ZERO,
              taxCategory: {
                id: getField(invoiceRow, '100') || DEFAULT_VALUES.TAX_CATEGORY.id,
                percent: getField(invoiceRow, '99') || DEFAULT_VALUES.ZERO,
                exemptionReason: getField(invoiceRow, '101') || DEFAULT_VALUES.TAX_CATEGORY.exemptionReason,
                taxScheme: {
                  id: getField(invoiceRow, '102') || 'OTH',
                  schemeId: getField(invoiceRow, '103') || 'UN/ECE 5153',
                  schemeAgencyId: String(getField(invoiceRow, '104') || '6')
                }
              }
            }]
          },
          item: {
            classification: {
              code: getField(invoiceRow, 'InvoiceItem'),
              type: getField(invoiceRow, '105')
            },
            description: getField(invoiceRow, '106'),
            originCountry: getField(invoiceRow, '107')
          },
          price: {
            amount: getField(invoiceRow, '108'),
            subtotal: getField(invoiceRow, '109'),
            extension: getField(invoiceRow, '109')
          }
        };

        // Add line item to document - with more flexible validation and debugging
        const hasLineId = lineItem.lineId !== undefined && lineItem.lineId !== null && lineItem.lineId !== '';
        const hasQuantity = lineItem.quantity !== undefined && lineItem.quantity !== null;
        const hasAmount = lineItem.lineExtensionAmount !== undefined && lineItem.lineExtensionAmount !== null;

        // Log line item validation for debugging
        logStep('Line Item Validation', {
          lineId: lineItem.lineId,
          hasLineId,
          quantity: lineItem.quantity,
          hasQuantity,
          lineExtensionAmount: lineItem.lineExtensionAmount,
          hasAmount,
          willAddLineItem: hasLineId || hasQuantity || hasAmount
        });

        // More flexible validation - add line item if at least one key field exists
        if (hasLineId || hasQuantity || hasAmount) {
          doc.items = [lineItem];
          logStep('Line Item Added', { lineItem });
        } else {
          logStep('Line Item Skipped - No Required Data', {
            availableFields: Object.keys(invoiceRow).filter(key =>
              key.includes('InvoiceLine') || key.includes('70') || key.includes('72')
            )
          });
        }

        // Process footer/summary data from the invoice row
        // Use line item tax data for summary if available, otherwise use footer fields
        const lineItemTaxData = doc.items && doc.items.length > 0 && doc.items[0].taxTotal?.taxSubtotal?.[0]?.taxCategory;

        const footerData = {
          amounts: {
            lineExtensionAmount: getField(invoiceRow, 'LegalMonetaryTotal') || DEFAULT_VALUES.ZERO,
            taxExclusiveAmount: getField(invoiceRow, '84') || DEFAULT_VALUES.ZERO,
            taxInclusiveAmount: getField(invoiceRow, '85') || DEFAULT_VALUES.ZERO,
            allowanceTotalAmount: getField(invoiceRow, '86') || DEFAULT_VALUES.ZERO,
            chargeTotalAmount: getField(invoiceRow, '87') || DEFAULT_VALUES.ZERO,
            payableRoundingAmount: getField(invoiceRow, '88') || DEFAULT_VALUES.ZERO,
            payableAmount: getField(invoiceRow, '89') || DEFAULT_VALUES.ZERO
          },
          tax: {
            totalAmount: getField(invoiceRow, 'Invoice_TaxTotal') || DEFAULT_VALUES.ZERO,
            taxableAmount: getField(invoiceRow, '78') || DEFAULT_VALUES.ZERO, // __EMPTY_78 for taxable amount
            taxExemptedAmount: getField(invoiceRow, '79') || DEFAULT_VALUES.ZERO, // __EMPTY_79 for tax amount
            taxRate: lineItemTaxData?.percent || getField(invoiceRow, '99') || DEFAULT_VALUES.ZERO, // Use line item tax rate
            taxAmount: getField(invoiceRow, 'Invoice_TaxTotal') || DEFAULT_VALUES.ZERO,
            taxTypeCode: lineItemTaxData?.id || getField(invoiceRow, '80') || DEFAULT_VALUES.NOT_APPLICABLE, // __EMPTY_80 for tax type code
            taxExemptionReason: lineItemTaxData?.exemptionReason || getField(invoiceRow, '101') || DEFAULT_VALUES.NOT_APPLICABLE, // Use line item exemption reason
            taxSubtotal: {
              taxableAmount: getField(invoiceRow, '78') || DEFAULT_VALUES.ZERO, // __EMPTY_78 for taxable amount
              taxAmount: getField(invoiceRow, 'Invoice_TaxTotal') || DEFAULT_VALUES.ZERO
            },
            category: {
              id: lineItemTaxData?.id || getField(invoiceRow, '80') || DEFAULT_VALUES.TAX_CATEGORY.id, // __EMPTY_80 for tax category
              exemptionReason: lineItemTaxData?.exemptionReason || getField(invoiceRow, '101') || DEFAULT_VALUES.TAX_CATEGORY.exemptionReason,
              scheme: {
                id: lineItemTaxData?.taxScheme?.id || getField(invoiceRow, '81') || DEFAULT_VALUES.TAX_SCHEME.id // __EMPTY_81 for tax scheme
              }
            }
          },
          taxTotal: {
            taxAmount: getField(invoiceRow, 'Invoice_TaxTotal') || DEFAULT_VALUES.ZERO,
            taxSubtotal: [{
              taxableAmount: getField(invoiceRow, '78') || DEFAULT_VALUES.ZERO, // __EMPTY_78 for taxable amount
              taxAmount: getField(invoiceRow, 'Invoice_TaxTotal') || DEFAULT_VALUES.ZERO,
              taxCategory: {
                id: getField(invoiceRow, '80') || DEFAULT_VALUES.TAX_CATEGORY.id, // __EMPTY_80 for tax category ID
                percent: getField(invoiceRow, '99') || DEFAULT_VALUES.ZERO, // __EMPTY_99 for tax percent
                exemptionReason: getField(invoiceRow, '101') || DEFAULT_VALUES.TAX_CATEGORY.exemptionReason, // __EMPTY_101 for exemption reason
                taxScheme: {
                  id: getField(invoiceRow, '81') || DEFAULT_VALUES.TAX_CATEGORY.scheme.id // __EMPTY_81 for tax scheme ID
                }
              }
            }]
          }
        };

        // Update document summary with footer data
        doc.summary = footerData;

        logRawToJson(doc, `${doc.header.invoiceNo}_eInvoice`);

        return doc;
      };

      // Note: processLineItem function removed - line item processing is now integrated into createNewDocument

      // Helper function to collect all address lines from multiple fields in the same row
      // Note: In new structure, address data comes from consecutive fields in the single invoice row
      const collectAddressLines = (baseField, invoiceRow) => {
        const addressLines = [];

        // Convert baseField to number to get consecutive fields
        const baseFieldNum = parseInt(baseField);

        // Get address from the base field and the next field (e.g., field 25 and 26)
        for (let i = 0; i < 2; i++) {
          const fieldNum = baseFieldNum + i;
          const address = getField(invoiceRow, fieldNum.toString());

          if (address && address !== 'NA' && address !== null) {
            // Convert to string, normalize commas/spaces, and trim trailing commas
            let addressStr = String(address).trim();
            if (addressStr && addressStr.toLowerCase() !== 'null') {
              addressStr = addressStr
                .replace(/\s*,\s*/g, ', ')   // collapse comma spacing
                .replace(/,+/g, ',')           // collapse repeated commas
                .replace(/,\s*$/,'')          // remove trailing comma
                .replace(/\s{2,}/g,' ');      // collapse spaces
              if (addressStr) addressLines.push(addressStr);
            }
          }
        }

        return addressLines;
      };

      // Helper function to process address lines
      const processAddressLine = (addressLine, invoiceRow, dataRows, currentIndex, baseField) => {
        // If we have invoiceRow and baseField, collect address lines from consecutive fields
        if (invoiceRow && baseField) {
          const addressLines = collectAddressLines(baseField, invoiceRow);

          if (addressLines.length === 0) return "NA";

          // Join all address lines with commas and space
          return addressLines.join(', ');
        }

        // If we only have a single address line (legacy behavior)
        if (!addressLine) return "NA";

        // Convert to string and handle special cases
        const addressStr = String(addressLine);
        if (addressStr.toLowerCase() === 'na' || addressStr.trim() === '') {
          return "NA";
        }

        return addressStr;
      };

      const DEFAULT_VALUES = {
        CURRENCY: 'MYR',
        COUNTRY: 'MYS',
        COUNTRY_SCHEME: {
          listId: 'ISO3166-1',
          agencyId: '6'
        },
        TAX_SCHEME: {
          id: 'OTH'  // Changed from 'OTH' to 'VAT' as per LHDN
        },
        NOT_APPLICABLE: 'NA',
        ZERO: 0,
        TAX_CATEGORY: {
          id: '01',
          exemptionReason: 'NA',
          scheme: {
            id: 'OTH'  // Changed from 'OTH' to 'VAT'
          }
        }
      };

      // Note: createTaxSubtotal function removed - tax processing is now integrated into createNewDocument

      // Note: processMultipleTaxTypes and processFooter functions removed
      // - tax and footer processing is now integrated into createNewDocument

      /**
       * Process each row in the Excel data:
       * New structure: Each row with a valid invoice number is a complete invoice document
       * Starting from row 4 (index 0 in dataRows after skipping 3 header rows)
       */
      dataRows.forEach((row, index) => {
        const rowType = getRowType(row);

        // Process rows that contain valid invoice data
        if (rowType === 'INVOICE' && row.Invoice) {
          try {
            // Create complete document from invoice row (includes header, line items, and footer data)
            const completeDocument = createNewDocument(row, dataRows, index);
            documents.push(completeDocument);

            logStep('Processed Invoice Row as Complete Document', {
              invoiceNo: completeDocument.header.invoiceNo,
              rowIndex: index + 3, // Add 3 because we skipped 2 header rows (0-based index + 2 header rows + 1 for 1-based)
              hasLineItems: completeDocument.items && completeDocument.items.length > 0,
              hasSummary: !!completeDocument.summary
            });
          } catch (error) {
            logStep('Error Processing Invoice Row', {
              invoiceNo: row.Invoice,
              rowIndex: index + 3,
              error: error.message
            });
            console.error(`Error processing invoice ${row.Invoice}:`, error);
          }
        } else if (row.Invoice) {
          // Log skipped rows for debugging
          logStep('Skipped Row - Not Valid Invoice', {
            invoiceValue: row.Invoice,
            rowIndex: index + 4,
            rowType: rowType
          });
        }
      });

      // Note: No need to handle currentDocument since each H row creates a complete document

      logger.info('Processed documents:', documents.length);

      // Always write logs for debugging
      try {
        const logsDir = path.join(process.cwd(), 'logs', 'excel');
        if (!fs.existsSync(logsDir)) {
          fs.mkdirSync(logsDir, { recursive: true });
        }

        // Log raw data structure for new format
        const rawDataLog = {
          timestamp: new Date().toISOString(),
          structure: 'NEW_INVOICE_BASED',
          columnHeaders,
          fieldMappings,
          sampleDataRow: dataRows[0],
          invoiceRows: {
            total: dataRows.filter(row => getRowType(row) === 'INVOICE').length,
            sample: dataRows.filter(row => getRowType(row) === 'INVOICE').slice(0, 3).map(row => ({
              invoice: row.Invoice,
              rowType: getRowType(row)
            }))
          },
          // Legacy row types for backward compatibility
          legacyRowTypes: {
            header: dataRows.find(row => getRowType(row)?.toString().toUpperCase().charAt(0) === 'H'),
            line: dataRows.find(row => getRowType(row)?.toString().toUpperCase().charAt(0) === 'L'),
            footer: dataRows.find(row => getRowType(row)?.toString().toUpperCase().charAt(0) === 'F')
          }
        };

        // Log all raw Excel data for debugging new structure
        const rawExcelData = {
          timestamp: new Date().toISOString(),
          structure: 'NEW_INVOICE_BASED',
          metadataRows: {
            columnHeaders,
            fieldMappings
          },
          allDataRows: dataRows.map((row, index) => {
            // Extract key fields for clarity
            const keyFields = {};
            for (const key of Object.keys(row)) {
              // Include address fields and other important fields
              if (key.includes('21') || key.includes('32') || key.includes('43') ||
                  key === 'Invoice' || key.includes('Supplier') || key.includes('Buyer') || key.includes('Delivery')) {
                keyFields[key] = row[key];
              }
            }
            return {
              actualRowIndex: index + 3, // Add 3 because we skipped 2 header rows
              dataRowIndex: index,
              rowType: getRowType(row),
              invoice: row.Invoice,
              supplier: row.Supplier,
              buyer: row.Buyer,
              delivery: row.Delivery,
              keyFields
            };
          })
        };

        // Write raw Excel data log specifically for address debugging
        const rawExcelLogPath = path.join(logsDir, `excel_raw_${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
        fs.writeFileSync(rawExcelLogPath, JSON.stringify(rawExcelData, null, 2));

        // Write raw data log
        const rawDataLogPath = path.join(logsDir, `raw_data_${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
        fs.writeFileSync(rawDataLogPath, JSON.stringify(rawDataLog, null, 2));

        // Write process logs
        const processLogPath = path.join(logsDir, `process_${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
        fs.writeFileSync(processLogPath, JSON.stringify(processLogs, null, 2));

        logger.info('Logs written to:', logsDir);
      } catch (logError) {
        logger.error('Error writing logs:', logError);
        // Don't throw the error as logging failure shouldn't stop processing
      }

      return documents;

    } catch (error) {
      logger.error('Error processing Excel data:', error);
      addToProcessLog({
        error: error.message,
        stack: error.stack
      }, 'errors');
      throw error;
    }
  };

  module.exports = { processManualUploadExcelData };