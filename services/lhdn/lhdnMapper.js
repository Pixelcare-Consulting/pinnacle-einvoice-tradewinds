const fs = require('fs');
const path = require('path');
const { getCertificatesHashedParams } = require('./lhdnService');

/**
 * Logger configuration for mapping process
 */
const createLogger = () => {
  const logs = {
    steps: [],
    mappings: [],
    errors: []
  };

  const logStep = (step, data) => {
    logs.steps.push({
      timestamp: new Date().toISOString(),
      step,
      data
    });
  };

  const logMapping = (section, input, output) => {
    logs.mappings.push({
      timestamp: new Date().toISOString(),
      section,
      input,
      output
    });
  };

  const logError = (error, context) => {
    logs.errors.push({
      timestamp: new Date().toISOString(),
      error: error.message,
      stack: error.stack,
      context
    });
  };

  const writeLogs = (invoiceNo, lhdnFormat) => {
    try {
      const logsDir = path.join(process.cwd(), 'logs', 'lhdn');
      if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true });
      }

      // Write processing logs
      const processLogFileName = `lhdn_process_${invoiceNo}_${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      const processLogPath = path.join(logsDir, processLogFileName);
      fs.writeFileSync(processLogPath, JSON.stringify(logs, null, 2));
      console.log(`[INFO] LHDN Processing logs written to: ${processLogPath}`);

      // Write LHDN format JSON
      const lhdnFileName = `lhdn_output_${invoiceNo}_${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      const lhdnPath = path.join(logsDir, lhdnFileName);
      fs.writeFileSync(lhdnPath, JSON.stringify(lhdnFormat, null, 2));
      console.log(`[INFO] LHDN Output JSON written to: ${lhdnPath}`);
    } catch (error) {
      console.error('[ERROR] Failed to write LHDN logs:', error);
    }
  };

  return {
    logStep,
    logMapping,
    logError,
    writeLogs,
    getLogs: () => logs
  };
};

// Helper functions
const convertToBoolean = (value) => {
  if (value === true || value === 'true' || value === 1) return true;
  if (value === false || value === 'false' || value === 0) return false;
  return false; // default to false if undefined/null
};

const wrapValue = (value, currencyID = null) => {
  // For currency amounts, keep as numbers or return undefined if invalid
  if (currencyID) {
    const numValue = Number(value);
    if (!isNaN(numValue)) {
      return [{
        "_": numValue,
        "currencyID": currencyID
      }];
    }
    return undefined;
  }

  // For non-currency fields, convert null/undefined to empty string
  if (value === null || value === undefined || value === '') {
    return [{
      "_": ""
    }];
  }

  // Convert everything else to string
  return [{
    "_": String(value)
  }];
};

const wrapBoolean = (value) => {
  return [{
    "_": convertToBoolean(value)
  }];
};

const wrapNumericValue = (value) => {
  if (value === null || value === undefined || value === '') {
    return undefined;
  }
  const numValue = Number(value);
  return isNaN(numValue) ? undefined : [{
    "_": numValue
  }];
};

// Normalize Malaysian state to official 2-digit code (per LHDN StateCodes)
const STATE_NAME_TO_CODE = {
  'JOHOR': '01',
  'KEDAH': '02',
  'KELANTAN': '03',
  'MELAKA': '04',
  'MELACCA': '04',
  'NEGERI SEMBILAN': '05',
  'PAHANG': '06',
  'PULAU PINANG': '07',
  'PENANG': '07',
  'PERAK': '08',
  'PERLIS': '09',
  'SELANGOR': '10',
  'TERENGGANU': '11',
  'SABAH': '12',
  'SARAWAK': '13',
  'WILAYAH PERSEKUTUAN KUALA LUMPUR': '14',
  'WP KUALA LUMPUR': '14',
  'W.P. KUALA LUMPUR': '14',
  'KUALA LUMPUR': '14',
  'WILAYAH PERSEKUTUAN LABUAN': '15',
  'WP LABUAN': '15',
  'LABUAN': '15',
  'WILAYAH PERSEKUTUAN PUTRAJAYA': '16',
  'WP PUTRAJAYA': '16',
  'PUTRAJAYA': '16',
  'NOT APPLICABLE': '17',
  'N/A': '17',
  'NA': '17'
};

function toStateCode(value) {
  if (value === undefined || value === null) return undefined;
  let v = String(value).trim();
  if (!v) return undefined;
  // Already a numeric code? normalize to 2 digits
  if (/^\d{1,2}$/.test(v)) {
    const n = parseInt(v, 10);
    if (n >= 1 && n <= 17) return String(n).padStart(2, '0');
  }
  // Try to map by name (case-insensitive)
  const up = v.toUpperCase().replace(/\s+/g, ' ').replace(/\.$/, '');
  if (STATE_NAME_TO_CODE[up]) return STATE_NAME_TO_CODE[up];
  // Heuristics: if includes key tokens
  if (up.includes('KUALA LUMPUR')) return '14';
  if (up.includes('LABUAN')) return '15';
  if (up.includes('PUTRAJAYA')) return '16';
  // Fallback: return original if it looks like a valid code; otherwise undefined
  return undefined;
}


const formatDateTime = (date) => {
  if (!date) return undefined;

  // If date is already a string in correct format, return it
  if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(date)) {
    return date;
  }

  try {
    // Convert to Date object if it isn't already
    const dateObj = new Date(date);
    if (isNaN(dateObj.getTime())) {
      return undefined;
    }
    // Format as ISO string and remove milliseconds and timezone
    return dateObj.toISOString().split('.')[0];
  } catch (error) {
    console.error('Error formatting date:', error);
    return undefined;
  }
};

const mapAddressLines = (line) => {
  if (!line) return undefined;

  // Convert to string and handle special cases
  const addressStr = String(line);
  if (addressStr.toLowerCase() === 'na' || addressStr.trim() === '') {
    return [{
      "Line": [{ "_": "NA" }]
    }];
  }

  // Split the address line by commas or line breaks
  let lines = addressStr.split(/[,\n]/).map(l => l.trim()).filter(l => l);

  // If there are no commas, try to intelligently split the address
  if (lines.length === 1) {
    // Common address patterns for various address types
    const commonAddressPatterns = /\s+(?=\d+[A-Za-z]|\d+,|Jalan|Taman|Persiaran|Lorong|Kampung|Kg\.|Bandar|Street|Road|Lane|Avenue|Block|Unit|Floor|Level|Plaza|Tower|Building|Complex|Park|Garden|Heights|Court|Apartment|Suite|Room|House|No\.|No\s+\d+)/i;

    if (addressStr.match(commonAddressPatterns)) {
      const parts = addressStr.split(commonAddressPatterns);
      lines = parts.map(p => p.trim()).filter(p => p);
    }
  }

  // Ensure we don't have duplicate country codes in address lines
  lines = lines.filter(line =>
    !line.match(/^(MYS|Malaysia|SGP|Singapore)$/i) ||
    lines.indexOf(line) === lines.findIndex(l => l.match(/^(MYS|Malaysia|SGP|Singapore)$/i))
  );

  // Remove any duplicate address lines
  const uniqueLines = [...new Set(lines)];

  // Format address lines properly
  const formattedLines = uniqueLines.map(line => {
    // If this is a line that should end with a comma but doesn't, add one
    // This applies to address prefixes like PLO, No., Block, etc.
    if (line.match(/^(PLO|No\.|Block|Unit|Floor|Level)\s+\d+$/i)) {
      return line + ',';
    }
    return line;
  });

  return formattedLines.map(l => ({
    "Line": [{ "_": l }]
  }));
};

const mapAllowanceCharges = (charges) => {
  if (!charges || !Array.isArray(charges)) {
    charges = [charges];
  }

  return charges.map(charge => ({
    "ChargeIndicator": wrapBoolean(charge.indicator),
    "AllowanceChargeReason": wrapValue(charge.reason || 'NA'),
    "MultiplierFactorNumeric": charge.multiplierFactorNumeric ? [{
      "_": charge.multiplierFactorNumeric
    }] : undefined,
    "Amount": wrapValue(charge.amount || 0, 'MYR')
  })).filter(c => c);
};

const mapCommodityClassifications = (item) => {
  const classifications = [];

  if (item.classification?.code) {
    // Special handling for consolidated invoices (code 004)
    if (item.classification.code === '004') {
      classifications.push({
        "ItemClassificationCode": [{
          "_": "004",
          "listID": "CLASS",
          "name": "Consolidated Receipt"
        }]
      });
    } else {
      classifications.push({
        "ItemClassificationCode": [{
          "_": item.classification.code,
          "listID": item.classification.type || 'CLASS'
        }]
      });
    }
  }

  // Add PTC classification if exists
  if (item.ptcCode) {
    classifications.push({
      "ItemClassificationCode": [{
        "_": item.ptcCode,
        "listID": "PTC"
      }]
    });
  }

  return classifications;
};

const mapPartyIdentifications = (identifications = []) => {
  const requiredTypes = ['TIN', 'BRN' || 'NRIC' || 'PASSPORT' || 'ARMY', 'SST', 'TTX'];

  const idMap = identifications.reduce((acc, id) => {
    if (id && id.schemeId) {
      acc[id.schemeId] = id.id || "";
    }
    return acc;
  }, {});

  return requiredTypes.map(schemeId => ({
    "ID": [{
      "_": idMap[schemeId] || "",
      "schemeID": schemeId,
    }]
  }));
};

const mapPartyAddress = (address) => {
  return {
    "CityName": wrapValue(address.city),
    "PostalZone": wrapValue(address.postcode),
    "CountrySubentityCode": wrapValue(toStateCode(address.state) || address.state),
    "AddressLine": mapAddressLines(address.line || ""),
    "Country": [{
      "IdentificationCode": [{
        "_": address.country,
        "listID": "ISO3166-1",
        "listAgencyID": "6"
      }]
    }]
  };
};

const DEFAULT_VALUES = {
  TAX_SCHEME: {
    id: 'OTH',
    schemeId: 'UN/ECE 5153',
    schemeAgencyId: '6'
  },
  TAX_CATEGORY: {
    id: '01',
    exemptionReason: 'NA'
  }
};

const mapTaxScheme = (scheme) => {
  const defaultScheme = DEFAULT_VALUES.TAX_SCHEME;
  return [{
    "ID": [{
      "_": String(scheme?.id || defaultScheme.id),
      "schemeID": scheme?.schemeId || defaultScheme.schemeId,
      "schemeAgencyID": scheme?.schemeAgencyId || defaultScheme.schemeAgencyId
    }]
  }];
};

const mapTaxCategory = (taxCategory, taxScheme) => {
  return [{
    "ID": wrapValue(String(taxCategory?.id || DEFAULT_VALUES.TAX_CATEGORY.id)),
    "TaxExemptionReason": taxCategory?.exemptionReason ? wrapValue(taxCategory.exemptionReason) : undefined,
    "TaxScheme": mapTaxScheme(taxScheme)
  }];
};


const mapTaxTotalLine = (taxTotal, documentCurrencyCode, taxCurrencyCode, exchangeRate) => {
  if (!taxTotal) return [];

  return [{
      "TaxAmount": wrapValue(taxTotal.taxAmount, taxCurrencyCode || 0, taxCurrencyCode),
      "TaxSubtotal": taxTotal.taxSubtotal?.map(subtotal => ({
          "TaxableAmount": wrapValue(subtotal.taxableAmount, documentCurrencyCode || 0, documentCurrencyCode),
          "TaxAmount": wrapValue(subtotal.taxAmount, taxCurrencyCode || 0, taxCurrencyCode),
          "TaxCategory": [{
              "ID": [{
                  "_": subtotal.taxCategory?.id || DEFAULT_VALUES.TAX_CATEGORY.id
              }],
              "Percent": wrapNumericValue(subtotal.taxCategory?.percent || 0),
              "TaxExemptionReason": subtotal.taxCategory?.exemptionReason ?
                  wrapValue(subtotal.taxCategory.exemptionReason) : undefined,
              "TaxScheme": [{
                  "ID": [{
                      "_": subtotal.taxCategory?.taxScheme?.id || "OTH", // This should be "OTH"
                      "schemeID": "UN/ECE 5153",
                      "schemeAgencyID": "6"
                  }]
              }]
          }]
      })) || []
  }];
};

const mapTaxTotal = (taxTotal, documentCurrencyCode, taxCurrencyCode, exchangeRate) => {
  if (!taxTotal) return [];

  return [{
      "TaxAmount": wrapValue(taxTotal.taxAmount, taxCurrencyCode || 0, taxCurrencyCode),
      "TaxSubtotal": taxTotal.taxSubtotal?.map(subtotal => ({
          "TaxableAmount": wrapValue(subtotal.taxableAmount, documentCurrencyCode || 0, documentCurrencyCode),
          "TaxAmount": wrapValue(subtotal.taxAmount, taxCurrencyCode || 0, taxCurrencyCode),
          "TaxCategory": [{
              "ID": [{
                  "_": subtotal.taxCategory?.id || DEFAULT_VALUES.TAX_CATEGORY.id
              }],
              "TaxScheme": [{
                  "ID": [{
                      "_": subtotal.taxCategory?.taxScheme?.id || "OTH",
                      "schemeID": "UN/ECE 5153",
                      "schemeAgencyID": "6"
                  }]
              }]
          }]
      })) || []
  }];
};

const mapLineItem = (item, documentCurrencyCode, taxCurrencyCode, exchangeRate) => {
  if (!item) return null;

  // Special handling for consolidated receipts
  const isConsolidatedReceipt = item.item?.classification?.code === '004';
  const description = isConsolidatedReceipt ?
    `Receipt ${item.item.description}` :
    item.item.description;

  return {
    "ID": wrapValue(String(item.lineId)),
    "InvoicedQuantity": [{
      "_": Number(item.quantity),
      "unitCode": item.unitCode
    }],
    "LineExtensionAmount": wrapValue(item.lineExtensionAmount, documentCurrencyCode),
    "AllowanceCharge": item.allowanceCharges.map(charge => ({
      "ChargeIndicator": wrapBoolean(charge.chargeIndicator),
      "AllowanceChargeReason": wrapValue(charge.reason || 'NA'),
      "MultiplierFactorNumeric": charge.multiplierFactorNumeric ? wrapNumericValue(charge.multiplierFactorNumeric) : undefined,
      "Amount": wrapValue(charge.amount, documentCurrencyCode || 0, documentCurrencyCode)
    })),
    "TaxTotal": mapTaxTotalLine(item.taxTotal, documentCurrencyCode, taxCurrencyCode, exchangeRate),
    "Item": [{
      "CommodityClassification": mapCommodityClassifications(item.item),
      "Description": wrapValue(description),
      "OriginCountry": [{
        "IdentificationCode": [{
          "_": item.item.originCountry || "",
          "listID": "ISO3166-1",
          "listAgencyID": "6"
        }]
      }]
    }],
    "Price": [{
      "PriceAmount": wrapValue(item.price.amount, documentCurrencyCode)
    }],
    "ItemPriceExtension": [{
      "Amount": wrapValue(item.price.extension, documentCurrencyCode)
    }]
  };
};

const mapInvoiceLines = (items, documentCurrencyCode, taxCurrencyCode, exchangeRate) => {
  if (!items || !Array.isArray(items)) {
    return [];
  }
  return items.map(item => mapLineItem(item, documentCurrencyCode, taxCurrencyCode, exchangeRate)).filter(Boolean);
};

// Add this helper function for document references
const mapDocumentReference = (reference) => {
  if (!reference) {
    return {
      "ID": wrapValue(""),
      "DocumentType": wrapValue("")
    };
  }
  return {
    "ID": wrapValue(reference.id || ""),
    "DocumentType": wrapValue(reference.type || ""),
    "DocumentDescription": reference.description ? wrapValue(reference.description) : undefined
  };
};

const mapToLHDNFormat = (excelData, version) => {
  const logger = createLogger();

  if (!excelData || !Array.isArray(excelData) || excelData.length === 0) {
    const error = new Error('No document data provided');
    logger.logError(error, { excelData });
    throw error;
  }

  const doc = excelData[0];

  if (!doc || !doc.header || !doc.header.invoiceNo) {
    const error = new Error('Invalid document structure');
    logger.logError(error, { doc });
    throw error;
  }

  try {
    logger.logStep('Starting LHDN mapping', { version, documentId: doc.header.invoiceNo });

    // Log input document structure
    logger.logStep('Input Document Structure', {
      header: doc.header,
      parties: {
        supplier: doc.supplier,
        buyer: doc.buyer,
        delivery: doc.delivery
      },
      itemsCount: doc.items?.length,
      summary: doc.summary
    });

    const lhdnFormat = {
      "_D": "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2",
      "_A": "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2",
      "_B": "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2",
      "Invoice": [{
        "ID": wrapValue(doc.header.invoiceNo),
        "IssueDate": doc.header.issueDate,
        "IssueTime": doc.header.issueTime,
        "InvoiceTypeCode": [{
          "_": doc.header.invoiceType,
          "listVersionID": version
        }],
        "DocumentCurrencyCode": wrapValue(doc.header.documentCurrencyCode),
        "TaxCurrencyCode": wrapValue(doc.header.taxCurrencyCode),
        "InvoicePeriod": [{
          "StartDate": wrapValue(doc.header.invoicePeriod.startDate),
          "EndDate": wrapValue(doc.header.invoicePeriod.endDate),
          "Description": wrapValue(doc.header.invoicePeriod.description)
        }],
        "BillingReference": doc.header.documentReference?.billingReference ? [{
          "InvoiceDocumentReference": [{
            "ID": wrapValue(doc.header.InvoiceDocumentReference_ID || ""),
            "UUID": wrapValue(doc.header.invoiceDocumentReference || "")
          }],
        }] : [{
          "AdditionalDocumentReference": [
            mapDocumentReference({
              id: doc.header.documentReference?.billingReference || "",
              type: doc.header.documentReference?.billingReferenceType || ""
            }),
            ...(doc.header.documentReference?.additionalRefs || [])
              .map(ref => mapDocumentReference(ref))
              .filter(Boolean)
          ],
        }],
        "AdditionalDocumentReference": [
          mapDocumentReference({
            id: doc.header.documentReference?.billingReference || "",
            type: doc.header.documentReference?.billingReferenceType || ""
          }),
          ...(doc.header.documentReference?.additionalRefs || [])
            .map(ref => mapDocumentReference(ref))
            .filter(Boolean)
        ],
        "AccountingSupplierParty": [{
          "Party": [{
            "IndustryClassificationCode": [{
              "_": String(doc.supplier.industryClassificationCode),
              "name": doc.supplier.industryName
            }],
            "PartyIdentification": doc.supplier.identifications.map(id => ({
              "ID": [{
                "_": String(id.id),
                "schemeID": id.schemeId
              }]
            })),
            "PartyTaxScheme": [{
              "CompanyID": [{
                "_": "C5847470505" // Hardcoded TIN from AuthorizeToken.ini
              }],
              "TaxScheme": [{
                "ID": [{
                  "_": "GST",
                  "schemeID": "UN/ECE 5153",
                  "schemeAgencyID": "6"
                }]
              }]
            }],
            "PostalAddress": [mapPartyAddress(doc.supplier.address)],
            "PartyLegalEntity": [{
              "RegistrationName": wrapValue(doc.supplier.name)
            }],
            "Contact": [{
              "Telephone": wrapValue(doc.supplier.contact.phone),
              "ElectronicMail": wrapValue(doc.supplier.contact.email)
            }]
          }]
        }],
        "AccountingCustomerParty": [{
          "Party": [{
            "PartyIdentification": mapPartyIdentifications(doc.buyer.identifications),
            "PostalAddress": [{
              "CityName": wrapValue(doc.buyer.address.city),
              "PostalZone": wrapValue(doc.buyer.address.postcode),
              "CountrySubentityCode": wrapValue(toStateCode(doc.buyer.address.state) || doc.buyer.address.state),
              "AddressLine": mapAddressLines(doc.buyer.address.line),
              "Country": [{
                "IdentificationCode": [{
                  "_": doc.buyer.address.country,
                  "listID": "ISO3166-1",
                  "listAgencyID": "6"
                }]
              }]
            }],
            "PartyLegalEntity": [{
              "RegistrationName": wrapValue(doc.buyer.name)
            }],
            "Contact": [{
              "Telephone": wrapValue(doc.buyer.contact.phone),
              "ElectronicMail": wrapValue(doc.buyer.contact.email)
            }]
          }]
        }],
        ...(doc.delivery?.name && doc.delivery.name !== 'NA' ? {
          "Delivery": [{
            "DeliveryParty": [{
              ...(doc.delivery.identifications?.length > 0 && {
                "PartyIdentification": mapPartyIdentifications(doc.delivery.identifications)
              }),
              ...(doc.delivery.name && doc.delivery.name !== 'NA' && {
                "PartyLegalEntity": [{
                  "RegistrationName": wrapValue(doc.delivery.name)
                }]
              }),
              ...(doc.delivery.address && {
                "PostalAddress": [{
                  "CityName": wrapValue(doc.delivery.address.city),
                  "PostalZone": wrapValue(doc.delivery.address.postcode),
                  "CountrySubentityCode": wrapValue(toStateCode(doc.delivery.address.state) || doc.delivery.address.state),
                  "AddressLine": mapAddressLines(doc.delivery.address.line),
                  "Country": [{
                    "IdentificationCode": [{
                      "_": doc.delivery.address.country,
                      "listID": "ISO3166-1",
                      "listAgencyID": "6"
                    }]
                  }]
                }]
              })
            }],
            ...(doc.delivery.shipment && {
              "Shipment": [{
                "ID": wrapValue(doc.delivery.shipment.id),
                "FreightAllowanceCharge": [{
                  "ChargeIndicator": wrapBoolean(doc.delivery.shipment.freightAllowanceCharge.indicator),
                  "AllowanceChargeReason": wrapValue(doc.delivery.shipment.freightAllowanceCharge.reason),
                  "Amount": wrapValue(doc.delivery.shipment.freightAllowanceCharge.amount, doc.header.documentCurrencyCode)
                }]
              }]
            })
          }]
        } : {}),
        "PaymentMeans": [{
          "PaymentMeansCode": wrapValue(String(doc.payment.paymentMeansCode)),
          "PayeeFinancialAccount": [{
            "ID": wrapValue(doc.payment.payeeFinancialAccount)
          }]
        }],
        "PaymentTerms": [{
          "Note": wrapValue(doc.payment.paymentTerms)
        }],
        "PrepaidPayment": [{
          "ID": wrapValue(doc.payment.prepaidPayment.id),
          "PaidAmount": wrapValue(doc.payment.prepaidPayment.amount, doc.header.documentCurrencyCode),
          "PaidDate": wrapValue(doc.payment.prepaidPayment.date),
          "PaidTime": wrapValue(doc.payment.prepaidPayment.time)
        }],
        "AllowanceCharge": mapAllowanceCharges(doc.allowanceCharge),
        "TaxTotal": mapTaxTotal(doc.summary?.taxTotal, doc.header.documentCurrencyCode, doc.header.taxCurrencyCode),
        "LegalMonetaryTotal": [{
          "LineExtensionAmount": wrapValue(doc.summary.amounts.lineExtensionAmount, doc.header.documentCurrencyCode),
          "TaxExclusiveAmount": wrapValue(doc.summary.amounts.taxExclusiveAmount, doc.header.documentCurrencyCode),
          "TaxInclusiveAmount": wrapValue(doc.summary.amounts.taxInclusiveAmount, doc.header.documentCurrencyCode),
          "AllowanceTotalAmount": wrapValue(doc.summary.amounts.allowanceTotalAmount, doc.header.documentCurrencyCode),
          "ChargeTotalAmount": wrapValue(doc.summary.amounts.chargeTotalAmount, doc.header.documentCurrencyCode),
          "PayableRoundingAmount": wrapValue(doc.summary.amounts.payableRoundingAmount, doc.header.documentCurrencyCode),
          "PayableAmount": wrapValue(doc.summary.amounts.payableAmount, doc.header.documentCurrencyCode)
        }],
        "InvoiceLine": mapInvoiceLines(doc.items, doc.header.documentCurrencyCode, doc.header.taxCurrencyCode, doc.header.exchangeRate),
        "TaxExchangeRate": doc.header.taxCurrencyCode !== 'MYR' ? [{
          "SourceCurrencyCode": [{
            "_": doc.header.documentCurrencyCode
          }],
          "TargetCurrencyCode": [{
            "_": doc.header.taxCurrencyCode
          }],
          "CalculationRate": [{
            "_": Number(doc.header.exchangeRate) || 0
          }]
        }] : undefined
      }]
    };

    // Log header mapping
    logger.logMapping('Header', doc.header, lhdnFormat.Invoice[0]);

    // Map and log supplier party
    const supplierParty = {
      "AccountingSupplierParty": [{
        "AdditionalAccountID": [{
          "_": String(doc.supplier.additionalAccountID),
          "schemeAgencyName": doc.supplier.schemeAgencyName
        }],
        "Party": [{
          "IndustryClassificationCode": [{
            "_": String(doc.supplier.industryClassificationCode),
            "name": doc.supplier.industryName
          }],
          "PartyIdentification": doc.supplier.identifications.map(id => ({
            "ID": [{
              "_": String(id.id),
              "schemeID": id.schemeId
            }]
          })),
          "PostalAddress": [mapPartyAddress(doc.supplier.address)],
          "PartyLegalEntity": [{
            "RegistrationName": wrapValue(doc.supplier.name)
          }],
          "Contact": [{
            "Telephone": wrapValue(doc.supplier.contact.phone),
            "ElectronicMail": wrapValue(doc.supplier.contact.email)
          }]
        }]
      }]
    };

    lhdnFormat.Invoice[0] = { ...lhdnFormat.Invoice[0], ...supplierParty };
    logger.logMapping('Supplier', doc.supplier, supplierParty);

    // Map and log buyer party
    const buyerParty = {
      "AccountingCustomerParty": [{
        "Party": [{
          "PartyIdentification": mapPartyIdentifications(doc.buyer.identifications),
          "PostalAddress": [{
            "CityName": wrapValue(doc.buyer.address.city),
            "PostalZone": wrapValue(doc.buyer.address.postcode),
            "CountrySubentityCode": wrapValue(toStateCode(doc.buyer.address.state) || doc.buyer.address.state),
            "AddressLine": mapAddressLines(doc.buyer.address.line),
            "Country": [{
              "IdentificationCode": [{
                "_": doc.buyer.address.country,
                "listID": "ISO3166-1",
                "listAgencyID": "6"
              }]
            }]
          }],
          "PartyLegalEntity": [{
            "RegistrationName": wrapValue(doc.buyer.name)
          }],
          "Contact": [{
            "Telephone": wrapValue(doc.buyer.contact.phone),
            "ElectronicMail": wrapValue(doc.buyer.contact.email)
          }]
        }]
      }]
    };

    lhdnFormat.Invoice[0] = { ...lhdnFormat.Invoice[0], ...buyerParty };
    logger.logMapping('Buyer', doc.buyer, buyerParty);

    // Update tax and totals mapping
    const taxAndTotals = {
        "TaxTotal": mapTaxTotal(doc.summary?.taxTotal, doc.header.documentCurrencyCode, doc.header.taxCurrencyCode),
        "LegalMonetaryTotal": [{
            "LineExtensionAmount": wrapValue(doc.summary.amounts.lineExtensionAmount, doc.header.documentCurrencyCode),
            "TaxExclusiveAmount": wrapValue(doc.summary.amounts.taxExclusiveAmount, doc.header.documentCurrencyCode),
            "TaxInclusiveAmount": wrapValue(doc.summary.amounts.taxInclusiveAmount, doc.header.documentCurrencyCode),
            "AllowanceTotalAmount": wrapValue(doc.summary.amounts.allowanceTotalAmount, doc.header.documentCurrencyCode),
            "ChargeTotalAmount": wrapValue(doc.summary.amounts.chargeTotalAmount, doc.header.documentCurrencyCode),
            "PayableRoundingAmount": wrapValue(doc.summary.amounts.payableRoundingAmount, doc.header.documentCurrencyCode),
            "PayableAmount": wrapValue(doc.summary.amounts.payableAmount, doc.header.documentCurrencyCode)
        }]
    };

    // Only include delivery in final format if it has content
    if (Object.keys(taxAndTotals).length > 0) {
        lhdnFormat.Invoice[0] = { ...lhdnFormat.Invoice[0], ...taxAndTotals };
        logger.logMapping('TaxAndTotals', {
            taxTotal: doc.summary?.taxTotal,
            amounts: doc.summary?.amounts
        }, taxAndTotals);
    }

    // Add digital signature for version 1.1
    if (version === '1.1') {
      try {
        logger.logStep('Adding Digital Signature', { version });
        const { certificateJsonPortion_Signature, certificateJsonPortion_UBLExtensions } =
          getCertificatesHashedParams(lhdnFormat);

        lhdnFormat.Invoice[0].UBLExtensions = certificateJsonPortion_UBLExtensions;
        lhdnFormat.Invoice[0].Signature = certificateJsonPortion_Signature;

        logger.logMapping('DigitalSignature',
          { version, hasSignature: true },
          { UBLExtensions: lhdnFormat.Invoice[0].UBLExtensions, Signature: lhdnFormat.Invoice[0].Signature }
        );
      } catch (error) {
        logger.logError(error, { version, stage: 'digital_signature' });
        throw new Error('Failed to add digital signature for version 1.1');
      }
    }

    // Clean the object
    const cleanObject = (obj) => {
      Object.keys(obj).forEach(key => {
        if (obj[key] === undefined || obj[key] === null) {
          delete obj[key];
        } else if (typeof obj[key] === 'object') {
          cleanObject(obj[key]);
        }
      });
      return obj;
    };

    const cleanedFormat = cleanObject(lhdnFormat);
    logger.logStep('Mapping Complete', {
      documentId: doc.header?.invoiceNo,
      version,
      hasSignature: version === '1.1'
    });

    // Write both logs and LHDN format
    logger.writeLogs(doc.header?.invoiceNo || 'unknown', cleanedFormat);

    return cleanedFormat;

  } catch (error) {
    logger.logError(error, { stage: 'mapping', documentId: doc.header?.invoiceNo });
    throw error;
  }
};

module.exports = { mapToLHDNFormat };