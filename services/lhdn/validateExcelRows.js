const XLSX = require('xlsx');

// Add the getFieldValue helper function
const getFieldValue = (row, index) => {
  // Try all possible field formats in order
  const value = row[`__EMPTY_${index}`] ??  // Format: __EMPTY_28
         row[`_${index}`] ??         // Format: _28
         row[index] ??               // Format: 28
         row[`EMPTY_${index}`] ??    // Additional fallback format
         row[`${index}`] ??          // Another possible format
         row[`Column${index}`] ??    // Another possible format
         null;                       // Default to null if not found
  
  // console.log(`Getting field value for index ${index}:`, {
  //   value,
  //   formats: {
  //     empty: row[`__EMPTY_${index}`],
  //     underscore: row[`_${index}`],
  //     direct: row[index],
  //     emptyUnderscore: row[`EMPTY_${index}`],
  //     stringIndex: row[`${index}`],
  //     column: row[`Column${index}`]
  //   }
  // });
  
  return value;
};

// Updated field mapping based on actual Excel structure
const FIELD_MAPPINGS = {
  // Supplier fields (corrected based on raw data analysis)
  SUPPLIER_TIN: '15',        // __EMPTY_15 contains TIN (C4890799050)
  SUPPLIER_BRN: '16',        // __EMPTY_16 contains BRN (213588D)
  SUPPLIER_SST: '20',        // __EMPTY_20 contains SST
  SUPPLIER_TTX: '21',        // __EMPTY_21 contains TTX
  SUPPLIER_INDUSTRY_CODE: '13', // __EMPTY_13 contains industry code
  SUPPLIER_INDUSTRY_NAME: '14', // __EMPTY_14 contains industry name
  SUPPLIER_NAME: '31',       // __EMPTY_31 contains supplier name
  SUPPLIER_ADDRESS_LINE1: '25', // __EMPTY_25 contains address line 1
  SUPPLIER_ADDRESS_LINE2: '26', // __EMPTY_26 contains address line 2
  SUPPLIER_CITY: '22',       // __EMPTY_22 contains city
  SUPPLIER_POSTCODE: '23',   // __EMPTY_23 contains postcode
  SUPPLIER_STATE: '24',      // __EMPTY_24 contains state code
  SUPPLIER_COUNTRY: '28',    // __EMPTY_28 contains country
  SUPPLIER_PHONE: '32',      // __EMPTY_32 contains phone
  SUPPLIER_EMAIL: '33',      // __EMPTY_33 contains email

  // Buyer fields (corrected based on raw data analysis)
  BUYER_TIN: '34',           // __EMPTY_34 contains buyer TIN
  BUYER_BRN: 'Buyer',        // Buyer column contains BRN
  BUYER_SST: '38',           // __EMPTY_38 contains SST
  BUYER_TTX: '39',           // __EMPTY_39 contains TTX
  BUYER_NAME: '49',          // __EMPTY_49 contains buyer name
  BUYER_ADDRESS_LINE1: '43', // __EMPTY_43 contains address line 1
  BUYER_ADDRESS_LINE2: '44', // __EMPTY_44 contains address line 2
  BUYER_CITY: '40',          // __EMPTY_40 contains city
  BUYER_POSTCODE: '41',      // __EMPTY_41 contains postcode
  BUYER_STATE: '42',         // __EMPTY_42 contains state code
  BUYER_COUNTRY: '46',       // __EMPTY_46 contains country
  BUYER_PHONE: '50',         // __EMPTY_50 contains phone
  BUYER_EMAIL: '51',         // __EMPTY_51 contains email

  // Invoice fields
  INVOICE_NUMBER: 'Invoice',
  INVOICE_TYPE: '4',         // __EMPTY_4 contains invoice type
  CURRENCY: '5',             // __EMPTY_5 contains currency
  EXCHANGE_RATE: '7',        // __EMPTY_7 contains exchange rate

  // Tax fields
  TAX_TYPE_CODE: '80',       // __EMPTY_80 contains tax type code
  TAX_RATE: '99',            // __EMPTY_99 contains tax rate
  TAX_EXEMPTION_REASON: '101', // __EMPTY_101 contains exemption reason

  // Line item fields
  LINE_ID: 'InvoiceLine',
  QUANTITY: '90',            // __EMPTY_90 contains quantity
  UNIT_PRICE: '108',         // __EMPTY_108 contains unit price
  LINE_AMOUNT: '92',         // __EMPTY_92 contains line amount
  ITEM_DESCRIPTION: '106',   // __EMPTY_106 contains description
  ITEM_CLASSIFICATION: 'InvoiceItem', // InvoiceItem contains classification code

  // Monetary totals
  LINE_EXTENSION_AMOUNT: 'LegalMonetaryTotal',
  TAX_EXCLUSIVE_AMOUNT: '84',
  TAX_INCLUSIVE_AMOUNT: '85',
  PAYABLE_AMOUNT: '89'
};

// Add the getRowType helper function - updated for new structure
const getRowType = (row) => {
  // NEW APPROACH: Check if row has Invoice field (new document-centric structure)
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

  // LEGACY APPROACH: Check traditional __EMPTY field for H/L/F structure
  const legacyRowType = row[''] ||                  // Empty string column
         row['__EMPTY'] ||           // Original format
         row['_'] ||                 // Alternative format
         row['RowType'] ||           // Another possible format
         row['Type'] ||              // Another possible format
         row['Row_Type'] ||          // Another possible format
         row['Row Type'] ||          // Another possible format
         row['RowIdentifier'] ||     // Another possible format
         row['Row Identifier'] ||    // Another possible format
         null;                       // Default to null if not found

  // If legacy row type found, return it
  if (legacyRowType) {
    return legacyRowType;
  }

  // FALLBACK: If no row type found in standard columns, try to infer from data (legacy support)
  if (row) {
    // Check if this looks like a header row
    if (row['Invoice'] || row['InvoiceNumber'] || row['DocumentNumber']) {
      return 'H';
    }
    // Check if this looks like a line item row
    if (row['InvoiceLine'] || row['LineNumber'] || row['ItemNumber']) {
      return 'L';
    }
    // Check if this looks like a footer row
    if (row['LegalMonetaryTotal'] || row['TotalAmount'] || row['Invoice_TaxTotal']) {
      return 'F';
    }
  }

  // console.log('Getting row type:', {
  //   legacyRowType,
  //   possibleColumns: {
  //     empty: row[''],
  //     emptyDouble: row['__EMPTY'],
  //     underscore: row['_'],
  //     rowType: row['RowType'],
  //     type: row['Type'],
  //     rowIdentifier: row['RowIdentifier'],
  //     rowTypeUnderscore: row['Row_Type'],
  //     rowTypeSpace: row['Row Type']
  //   },
  //   invoiceValue: row?.Invoice,
  //   rowData: row
  // });

  return null; // No valid row type found
};

// Add the validatePartyIds function
const validatePartyIds = (row, partyType, rowValidation) => {
  if (!row) return;

  // Define field mappings for each party type based on actual Excel structure
  const partyFieldMappings = {
    'Supplier': {
      TIN: FIELD_MAPPINGS.SUPPLIER_TIN,
      BRN: FIELD_MAPPINGS.SUPPLIER_BRN,
      SST: FIELD_MAPPINGS.SUPPLIER_SST,
      TTX: FIELD_MAPPINGS.SUPPLIER_TTX
    },
    'Buyer': {
      TIN: FIELD_MAPPINGS.BUYER_TIN,
      BRN: FIELD_MAPPINGS.BUYER_BRN,
      SST: FIELD_MAPPINGS.BUYER_SST,
      TTX: FIELD_MAPPINGS.BUYER_TTX
    }
  };

  const fieldMapping = partyFieldMappings[partyType];
  if (!fieldMapping) return;

  // Validate each identification type
  Object.entries(fieldMapping).forEach(([schemeType, fieldKey]) => {
    let id;

    // Handle special case for Buyer BRN which is in the 'Buyer' column
    if (fieldKey === 'Buyer') {
      id = row.Buyer;
    } else {
      id = getFieldValue(row, fieldKey);
    }

    // console.log(`Validating ${partyType} ${schemeType}:`, {
    //   fieldKey,
    //   id,
    //   schemeType,
    //   rawValue: fieldKey === 'Buyer' ? row.Buyer : getFieldValue(row, fieldKey)
    // });

    // Validate the ID if it exists and is not 'NA'
    if (id && String(id).trim() !== '' && String(id).trim() !== 'NA') {
      const idStr = String(id).trim();

      switch (schemeType) {
        case 'TIN':
          if (!idStr.match(/^[A-Z0-9]+$/)) {
            rowValidation.errors.push(`Invalid ${partyType} TIN format: ${idStr}`);
          }
          break;
        case 'BRN':
          if (!idStr.match(/^[A-Z0-9]+$/)) {
            rowValidation.errors.push(`Invalid ${partyType} BRN format: ${idStr}`);
          }
          break;
        case 'SST':
          if (idStr !== 'NA' && !idStr.match(/^W\d{2}-\d{4}-\d{8}$/)) {
            rowValidation.errors.push(`Invalid ${partyType} SST format: ${idStr}`);
          }
          break;
        case 'TTX':
          if (idStr !== 'NA' && !idStr.match(/^[A-Z0-9-\s]+$/)) {
            rowValidation.errors.push(`Invalid ${partyType} TTX format: ${idStr}`);
          }
          break;
      }
    }
  });
};

const validateExcelRows = (rawData) => {
    // New structure: Skip the first three rows (column headers, descriptions, field mappings) and process data rows
    const dataRows = rawData.slice(3);

    // Valid row identifiers for new structure
    const VALID_ROW_TYPES = new Set(['INVOICE', 'H', 'L', 'F', 'h', 'l', 'f', 'Header', 'Line', 'Footer']);

    // Add validation for scheme IDs
    const VALID_SCHEME_IDS = new Set(['TIN', 'BRN', 'SST', 'TTX']);

    const validationResults = {
      totalRows: dataRows.length,
      validRows: 0,
      invalidRows: 0,
      rowDetails: [],
      summary: {
        INVOICE: 0, // New structure
        H: 0,       // Legacy structure
        L: 0,       // Legacy structure
        F: 0,       // Legacy structure
        invalid: 0
      },
      structure: 'UNKNOWN' // Will be determined during validation
    };
  
    dataRows.forEach((row, index) => {
      const rowNum = index + 4; // Adding 4 because we skipped 3 header rows (0-based index + 3 header rows + 1 for 1-based)
      let rowType = getRowType(row); // Use the helper function to get row type

      // Determine structure type on first valid row
      if (validationResults.structure === 'UNKNOWN' && rowType) {
        if (rowType === 'INVOICE') {
          validationResults.structure = 'NEW_INVOICE_BASED';
        } else if (['H', 'L', 'F'].includes(rowType.toString().toUpperCase().charAt(0))) {
          validationResults.structure = 'LEGACY_HLF';
        }
      }

      const rowValidation = {
        rowNumber: rowNum,
        rowType: rowType,
        isValid: false,
        errors: [],
        invoiceNumber: row.Invoice || null
      };

      // Validate based on structure type
      if (validationResults.structure === 'NEW_INVOICE_BASED') {
        // New structure validation
        if (!rowType) {
          rowValidation.errors.push('Missing invoice identifier');
        } else if (rowType !== 'INVOICE') {
          rowValidation.errors.push(`Invalid row type: ${rowType}. Expected: INVOICE (valid invoice number)`);
        } else if (!row.Invoice || row.Invoice.toString().trim() === '') {
          rowValidation.errors.push('Missing or empty invoice number');
        }
      } else {
        // Legacy structure validation
        // Normalize row type to single character for legacy validation
        const normalizedRowType = rowType ? rowType.toString().toUpperCase().charAt(0) : null;

        if (!normalizedRowType) {
          rowValidation.errors.push('Missing row identifier');
        } else if (!['H', 'L', 'F'].includes(normalizedRowType)) {
          rowValidation.errors.push(`Invalid row identifier: ${normalizedRowType}. Expected: H, L, or F`);
        }

        // Update rowType for summary counting
        rowType = normalizedRowType;
      }
      // Additional validation based on structure type
      if (validationResults.structure === 'NEW_INVOICE_BASED') {
        // For new structure, validate invoice-specific fields
        if (rowType === 'INVOICE') {
          // Validate required invoice fields
          if (!row.Invoice || row.Invoice.toString().trim() === '') {
            rowValidation.errors.push('Missing invoice number');
          }

          // Validate party identification fields using the new structure
          validatePartyIds(row, 'Supplier', rowValidation);
          validatePartyIds(row, 'Buyer', rowValidation);

          // Validate required fields exist
          const requiredFields = [
            { field: FIELD_MAPPINGS.SUPPLIER_NAME, name: 'Supplier Name' },
            { field: FIELD_MAPPINGS.BUYER_NAME, name: 'Buyer Name' },
            { field: FIELD_MAPPINGS.CURRENCY, name: 'Currency' },
            { field: FIELD_MAPPINGS.LINE_EXTENSION_AMOUNT, name: 'Line Extension Amount' }
          ];

          requiredFields.forEach(({ field, name }) => {
            let value;
            if (field === 'Buyer') {
              value = row.Buyer;
            } else if (field === 'Invoice') {
              value = row.Invoice;
            } else if (field === 'LegalMonetaryTotal') {
              value = row.LegalMonetaryTotal;
            } else {
              value = getFieldValue(row, field);
            }

            if (!value || String(value).trim() === '' || String(value).trim() === 'NA') {
              rowValidation.errors.push(`Missing required field: ${name}`);
            }
          });
        }
      } else if (validationResults.structure === 'LEGACY_HLF') {
        // For legacy structure, validate scheme IDs for header rows
        if (rowType === 'H') {
          // For legacy structure, still use the old validation approach
          // This is kept for backward compatibility
         // console.log('Legacy validation not fully implemented for new field mappings');
        }
      }

      // Determine if row is valid
      if (rowValidation.errors.length === 0) {
        rowValidation.isValid = true;
        validationResults.summary[rowType]++;
        validationResults.validRows++;
      } else {
        validationResults.summary.invalid++;
        validationResults.invalidRows++;
      }

      // Add to detailed results
      validationResults.rowDetails.push(rowValidation);
    });
  
    // Add logical validation based on structure type
    if (validationResults.structure === 'NEW_INVOICE_BASED') {
      validationResults.logicalValidation = {
        hasInvoices: validationResults.summary.INVOICE > 0,
        invoiceCount: validationResults.summary.INVOICE,
        isValid: validationResults.summary.INVOICE > 0,
        structure: 'NEW_INVOICE_BASED'
      };
    } else if (validationResults.structure === 'LEGACY_HLF') {
      validationResults.logicalValidation = {
        hasHeader: validationResults.summary.H > 0,
        hasFooter: validationResults.summary.F > 0,
        hasLines: validationResults.summary.L > 0,
        isValid: validationResults.summary.H > 0 && validationResults.summary.F > 0,
        structure: 'LEGACY_HLF'
      };
    } else {
      validationResults.logicalValidation = {
        isValid: false,
        structure: 'UNKNOWN',
        error: 'Unable to determine Excel structure type'
      };
    }
  
    return validationResults;
  };
  
  const processAndValidateExcel = async (filePath) => {
    try {
      const workbook = XLSX.readFile(filePath);
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      const rawData = XLSX.utils.sheet_to_json(worksheet, {
        raw: true,
        defval: null,
        blankrows: false
      });
  
      // Validate rows
      const validationResults = validateExcelRows(rawData);
  
      // Log validation results
      // console.log('Validation Results:', {
      //   filePath,
      //   totalRows: validationResults.totalRows,
      //   validRows: validationResults.validRows,
      //   invalidRows: validationResults.invalidRows,
      //   summary: validationResults.summary,
      //   logicalValidation: validationResults.logicalValidation
      // });
  
      return {
        data: rawData,
        validation: validationResults
      };
    } catch (error) {
      console.error('Error in processAndValidateExcel:', error);
      throw error;
    }
  };
  
  module.exports = { validateExcelRows, processAndValidateExcel };