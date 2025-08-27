/**
 * Comprehensive LHDN Error Code Mapping System
 * Converts technical LHDN error codes into user-friendly, actionable error messages
 */

class LHDNErrorMapper {
    constructor() {
        this.errorCodeMap = {
            // Phone Number Validation Errors
            'CF410': {
                title: 'Invalid Phone Number Format',
                field: 'Supplier Phone Number',
                userMessage: 'The supplier phone number format is invalid',
                technicalMessage: 'Phone number does not meet LHDN format requirements',
                guidance: [
                    'Ensure the phone number includes the country code (e.g., +60)',
                    'Phone number must be at least 8 characters long',
                    'Remove any spaces, dashes, or special characters except +',
                    'Example: +60123456789 or 60123456789'
                ],
                severity: 'error',
                category: 'validation',
                fieldPath: 'Invoice.AccountingSupplierParty.Party.Contact.Telephone'
            },
            'CF414': {
                title: 'Phone Number Length Validation',
                field: 'Supplier Phone Number',
                userMessage: 'The supplier phone number is too short',
                technicalMessage: 'Enter valid phone number and the minimum length is 8 characters - SUPPLIER',
                guidance: [
                    'Phone number must be at least 8 characters long',
                    'Include country code (+60 for Malaysia)',
                    'Ensure all digits are present',
                    'Example: +60123456789'
                ],
                severity: 'error',
                category: 'validation',
                fieldPath: 'Invoice.AccountingSupplierParty.Party.Contact.Telephone'
            },
            'CF415': {
                title: 'Buyer Phone Number Validation',
                field: 'Buyer Phone Number',
                userMessage: 'The buyer phone number format is invalid',
                technicalMessage: 'Enter valid phone number and the minimum length is 8 characters - BUYER',
                guidance: [
                    'Buyer phone number must be at least 8 characters long',
                    'Include country code (+60 for Malaysia)',
                    'Remove spaces, dashes, or special characters except +',
                    'Example: +60123456789'
                ],
                severity: 'error',
                category: 'validation',
                fieldPath: 'Invoice.AccountingCustomerParty.Party.Contact.Telephone'
            },

            // Document Validation Errors
            'DS302': {
                title: 'Duplicate Document Submission',
                field: 'Invoice Number',
                userMessage: 'This document has already been submitted to LHDN',
                technicalMessage: 'Document with this invoice number already exists in LHDN system',
                guidance: [
                    'Check the document status in your LHDN portal',
                    'Use a different invoice number if creating a new document',
                    'If this is a correction, cancel the original document first',
                    'Contact LHDN support if you believe this is an error'
                ],
                severity: 'warning',
                category: 'duplicate',
                fieldPath: 'Invoice.ID'
            },

            // Date Validation Errors
            'CF321': {
                title: 'Invalid Document Date',
                field: 'Issue Date',
                userMessage: 'The document issue date is invalid or outside allowed range',
                technicalMessage: 'Document issue date validation failed',
                guidance: [
                    'Documents must be submitted within 7 days of issue date',
                    'Ensure the date format is correct (YYYY-MM-DD)',
                    'Check that the issue date is not in the future',
                    'Verify the date is within the allowed submission window'
                ],
                severity: 'error',
                category: 'validation',
                fieldPath: 'Invoice.IssueDate'
            },

            // Tax Calculation Errors
            'CF401': {
                title: 'Tax Calculation Error',
                field: 'Tax Amount',
                userMessage: 'There is an error in the tax calculations',
                technicalMessage: 'Tax amount calculation does not match expected values',
                guidance: [
                    'Verify all tax rates are correct',
                    'Check that tax amounts match the calculated values',
                    'Ensure tax-exempt items are properly marked',
                    'Review the total tax amount calculation'
                ],
                severity: 'error',
                category: 'calculation',
                fieldPath: 'Invoice.TaxTotal'
            },

            'CF402': {
                title: 'Currency Validation Error',
                field: 'Currency Code',
                userMessage: 'The currency information is invalid',
                technicalMessage: 'Currency code or exchange rate validation failed',
                guidance: [
                    'Use valid ISO currency codes (e.g., MYR, USD, SGD)',
                    'Ensure exchange rates are current and accurate',
                    'Check that all amounts use the same currency',
                    'Verify currency formatting is correct'
                ],
                severity: 'error',
                category: 'validation',
                fieldPath: 'Invoice.DocumentCurrencyCode'
            },

            'CF403': {
                title: 'Invalid Tax Code',
                field: 'Tax Code',
                userMessage: 'The tax code used is invalid or not recognized',
                technicalMessage: 'Tax classification code validation failed',
                guidance: [
                    'Use only valid Malaysian tax codes',
                    'Check the latest LHDN tax code list',
                    'Ensure tax codes match the item categories',
                    'Verify tax-exempt codes are used correctly'
                ],
                severity: 'error',
                category: 'validation',
                fieldPath: 'Invoice.InvoiceLine.TaxTotal.TaxSubtotal.TaxCategory.TaxScheme'
            },

            // Party Information Errors
            'CF404': {
                title: 'Invalid Identification Information',
                field: 'TIN/Registration Number',
                userMessage: 'The identification information is invalid',
                technicalMessage: 'Party identification validation failed',
                guidance: [
                    'Verify TIN numbers are correct and active',
                    'Check registration numbers format',
                    'Ensure identification matches LHDN records',
                    'Validate both supplier and buyer information'
                ],
                severity: 'error',
                category: 'validation',
                fieldPath: 'Invoice.AccountingSupplierParty.Party.PartyIdentification'
            },

            'CF405': {
                title: 'Invalid Party Information',
                field: 'Company Information',
                userMessage: 'The company or party information is invalid',
                technicalMessage: 'Party details validation failed',
                guidance: [
                    'Check company name spelling and format',
                    'Verify address information is complete',
                    'Ensure contact details are valid',
                    'Confirm party registration details'
                ],
                severity: 'error',
                category: 'validation',
                fieldPath: 'Invoice.AccountingSupplierParty.Party'
            },

            // Item Classification Errors
            'CF364': {
                title: 'Invalid Item Classification',
                field: 'Item Classification Code',
                userMessage: 'One or more item classifications are invalid',
                technicalMessage: 'Item classification code validation failed',
                guidance: [
                    'Use valid UNSPSC or other approved classification codes',
                    'Check the latest classification code list',
                    'Ensure all items have proper classifications',
                    'Verify classification codes match item descriptions'
                ],
                severity: 'error',
                category: 'validation',
                fieldPath: 'Invoice.InvoiceLine.Item.CommodityClassification'
            },

            // Authentication Errors
            'AUTH001': {
                title: 'Authentication Failed',
                field: 'User Authentication',
                userMessage: 'Your authentication has expired or is invalid',
                technicalMessage: 'Authentication token validation failed',
                guidance: [
                    'Click "Logout and Refresh Token" to re-authenticate',
                    'Log back in with your credentials',
                    'Try submitting the document again',
                    'Contact your system administrator if issues persist'
                ],
                severity: 'error',
                category: 'authentication',
                fieldPath: null
            },

            // System Errors
            'NETWORK_ERROR': {
                title: 'Network Connection Error',
                field: 'System Connection',
                userMessage: 'Unable to connect to LHDN services',
                technicalMessage: 'Network communication error with LHDN API',
                guidance: [
                    'Check your internet connection',
                    'Try again in a few minutes',
                    'Contact support if the issue persists',
                    'Verify LHDN services are operational'
                ],
                severity: 'error',
                category: 'system',
                fieldPath: null
            },

            'TIMEOUT': {
                title: 'Request Timeout',
                field: 'System Response',
                userMessage: 'The request to LHDN timed out',
                technicalMessage: 'Request timeout while waiting for LHDN response',
                guidance: [
                    'The LHDN system may be busy',
                    'Try submitting again in a few minutes',
                    'Check if the document was actually submitted',
                    'Contact support if timeouts persist'
                ],
                severity: 'warning',
                category: 'system',
                fieldPath: null
            },

            // Generic fallback
            'VALIDATION_ERROR': {
                title: 'Document Validation Error',
                field: 'Document Data',
                userMessage: 'The document contains validation errors',
                technicalMessage: 'Document failed LHDN validation checks',
                guidance: [
                    'Review all document fields for accuracy',
                    'Ensure all required fields are completed',
                    'Check data formats match LHDN requirements',
                    'Contact support for assistance if needed'
                ],
                severity: 'error',
                category: 'validation',
                fieldPath: null
            }
        };
    }

    /**
     * Map an error code to user-friendly information
     * @param {string} errorCode - The LHDN error code
     * @param {string} originalMessage - Original error message from LHDN
     * @param {string} invoiceNumber - Invoice number that failed
     * @returns {Object} Formatted error information
     */
    mapError(errorCode, originalMessage = '', invoiceNumber = '') {
        const mapping = this.errorCodeMap[errorCode] || this.errorCodeMap['VALIDATION_ERROR'];

        return {
            code: errorCode,
            title: mapping.title,
            field: mapping.field,
            userMessage: mapping.userMessage,
            technicalMessage: originalMessage || mapping.technicalMessage,
            guidance: mapping.guidance,
            severity: mapping.severity,
            category: mapping.category,
            fieldPath: mapping.fieldPath,
            invoiceNumber: invoiceNumber,
            timestamp: new Date().toISOString()
        };
    }

    /**
     * Parse complex LHDN validation errors and extract meaningful information
     * @param {Object} lhdnError - The complex LHDN error object
     * @returns {Array} Array of parsed error details
     */
    parseLHDNValidationError(lhdnError) {
        const parsedErrors = [];

        try {
            // Handle different error structures
            let errorDetails = [];

            // Check if error has rejectedDocuments structure
            if (lhdnError.rejectedDocuments && Array.isArray(lhdnError.rejectedDocuments)) {
                const rejectedDoc = lhdnError.rejectedDocuments[0];
                if (rejectedDoc && rejectedDoc.error && rejectedDoc.error.details) {
                    errorDetails = Array.isArray(rejectedDoc.error.details)
                        ? rejectedDoc.error.details
                        : [rejectedDoc.error.details];
                }
            }
            // Check if error has direct details array
            else if (lhdnError.details && Array.isArray(lhdnError.details)) {
                errorDetails = lhdnError.details;
            }
            // Check if error has nested error.details
            else if (lhdnError.error && lhdnError.error.details) {
                errorDetails = Array.isArray(lhdnError.error.details)
                    ? lhdnError.error.details
                    : [lhdnError.error.details];
            }

            // Process each error detail
            errorDetails.forEach(detail => {
                const parsedError = this.parseValidationDetail(detail);
                if (parsedError) {
                    parsedErrors.push(parsedError);
                }
            });

            // If no specific errors found, create a generic one
            if (parsedErrors.length === 0) {
                parsedErrors.push({
                    code: 'VALIDATION_ERROR',
                    title: 'Document Validation Error',
                    field: 'Document Data',
                    userMessage: lhdnError.message || 'The document contains validation errors',
                    technicalMessage: lhdnError.message || 'Document failed LHDN validation',
                    guidance: [
                        'Review all document fields for accuracy',
                        'Ensure all required fields are completed',
                        'Check data formats match LHDN requirements'
                    ],
                    severity: 'error',
                    category: 'validation',
                    fieldPath: null
                });
            }

        } catch (error) {
            console.error('Error parsing LHDN validation error:', error);
            // Return a fallback error
            parsedErrors.push({
                code: 'PARSING_ERROR',
                title: 'Error Processing Validation Details',
                field: 'System',
                userMessage: 'Unable to process the validation error details',
                technicalMessage: error.message,
                guidance: ['Please contact support for assistance'],
                severity: 'error',
                category: 'system',
                fieldPath: null
            });
        }

        return parsedErrors;
    }

    /**
     * Get all error codes for a specific category
     * @param {string} category - Error category (validation, authentication, system, etc.)
     * @returns {Array} Array of error codes in the category
     */
    getErrorsByCategory(category) {
        return Object.keys(this.errorCodeMap).filter(code => 
            this.errorCodeMap[code].category === category
        );
    }

    /**
     * Check if an error code exists in the mapping
     * @param {string} errorCode - The error code to check
     * @returns {boolean} True if the error code is mapped
     */
    hasErrorCode(errorCode) {
        return this.errorCodeMap.hasOwnProperty(errorCode);
    }

    /**
     * Get severity level for an error code
     * @param {string} errorCode - The error code
     * @returns {string} Severity level (error, warning, info)
     */
    getSeverity(errorCode) {
        return this.errorCodeMap[errorCode]?.severity || 'error';
    }
}

// Create global instance
window.lhdnErrorMapper = new LHDNErrorMapper();

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = LHDNErrorMapper;
}
