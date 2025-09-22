// Error code translations - Consolidated ValidationTranslations
const ValidationTranslations = {
    // Enhanced error codes mapping (merged from both implementations)
    errorCodes: {
        // Original basic error codes
        'CV302': 'Invalid Code Value',
        'Error04': 'Field Validation Error',
        'CV303': 'Invalid Format',
        'CV304': 'Required Field Missing',
        'CV305': 'Invalid Date Format',
        'CV306': 'Invalid Number Format',
        'CV307': 'Invalid Currency Format',
        'CV308': 'Invalid Tax Code',
        'CV309': 'Invalid Document Type',
        'CV310': 'Invalid Reference',
        // Enhanced LHDN-specific error codes
        'DC511': 'Currency Validation Error',
        'DC512': 'Currency Format Error',
        'Error07': 'Document Currency Validator',
        'Error06': 'Document References Validator',
        'Error05': 'Taxpayer Profile Validator',
        'Error03': 'Duplicated Submission Validator',
        'CF401': 'Tax Calculation Error',
        'CF402': 'Amount Validation Error',
        'CF403': 'Date Validation Error',
        'AUTH001': 'Authentication Error',
        'SYS001': 'System Error'
    },

    // Enhanced field translations (merged from both implementations)
    fields: {
        // Original basic field mappings
        'AccountingSupplierParty.Party.PostalAddress.CountrySubentityCode': 'Supplier State Code',
        'AccountingCustomerParty.Party.PostalAddress.CountrySubentityCode': 'Customer State Code',
        'InvoiceLine.Item.CommodityClassification.ItemClassificationCode': 'Item Classification Code',
        'AccountingSupplierParty.Party.PartyTaxScheme.CompanyID': 'Supplier Tax ID',
        'AccountingCustomerParty.Party.PartyTaxScheme.CompanyID': 'Customer Tax ID',
        'InvoiceLine.Item.Description': 'Item Description',
        'PaymentMeans.PaymentMeansCode': 'Payment Method',
        'DocumentCurrencyCode': 'Currency Code',
        'TaxCurrencyCode': 'Tax Currency Code',
        'PaymentCurrencyCode': 'Payment Currency Code',
        'PaymentTerms.Note': 'Payment Terms',
        'InvoicePeriod.StartDate': 'Invoice Period Start',
        'InvoicePeriod.EndDate': 'Invoice Period End',
        // Enhanced LHDN-specific field mappings
        'Invoice.TaxExchangeRate.TargetCurrencyCode': 'Target Currency Code',
        'Invoice.TaxExchangeRate.SourceCurrencyCode': 'Source Currency Code',
        'Invoice.TaxExchangeRate.ExchangeRate': 'Exchange Rate',
        'Invoice.InvoiceNumber': 'Invoice Number',
        'Invoice.IssueDate': 'Issue Date',
        'Invoice.DueDate': 'Due Date',
        'Invoice.TotalAmount': 'Total Amount',
        'Invoice.TaxAmount': 'Tax Amount',
        'Invoice.Supplier.TIN': 'Supplier TIN',
        'Invoice.Supplier.Name': 'Supplier Name',
        'Invoice.Buyer.TIN': 'Buyer TIN',
        'Invoice.Buyer.Name': 'Buyer Name',
        'Invoice.DocumentCurrencyCode': 'Document Currency',
        'TargetCurrencyCode': 'Target Currency Code',
        'SourceCurrencyCode': 'Source Currency Code',
        'ExchangeRate': 'Exchange Rate'
    },

    // Error message patterns and their translations
    patterns: [
        {
            pattern: /ItemCode (.*?) does not exist in CodeType State Codes/,
            translation: (matches) => `The state code "${matches[1]}" is not in the correct format. Please use the official state code.`
        },
        {
            pattern: /ItemCode (.*?) does not exist in CodeType Classification Codes/,
            translation: (matches) => `The classification code "${matches[1]}" is not valid. Please use a valid item classification code.`
        },
        {
            pattern: /Invalid Code Field Validator/,
            translation: () => 'One or more fields contain invalid codes. Please check the details below.'
        }
    ],

    /**
     * Get user-friendly field name from property path (Enhanced implementation)
     * @param {string} propertyPath - The technical property path
     * @returns {string} User-friendly field name
     */
    getFieldName(propertyPath) {
        if (!propertyPath || propertyPath === 'Not specified') {
            return 'Not specified';
        }

        // First try direct mapping from enhanced fields
        if (this.fields[propertyPath]) {
            return this.fields[propertyPath];
        }

        // Remove JSON path syntax for legacy compatibility
        let readable = propertyPath.replace(/\$\.Invoice\[\*\]\./, '');
        readable = readable.replace(/\[\*\]/g, '');
        readable = readable.replace(/\._$/, '');

        // Try mapping again after cleanup
        if (this.fields[readable]) {
            return this.fields[readable];
        }

        // Fallback: clean up the property path for display
        return propertyPath.split('.').pop().replace(/([A-Z])/g, ' $1').trim();
    },

    /**
     * Get user-friendly error message (Enhanced implementation)
     * @param {string|object} message - The technical error message
     * @returns {string} User-friendly error message
     */
    getErrorMessage(message) {
        if (!message || message === 'Unknown error') {
            return 'An unknown validation error occurred';
        }

        // Handle different input types with enhanced error handling
        let errorString = "";
        if (typeof message === 'string') {
            errorString = message;
        } else if (typeof message === 'object' && message !== null) {
            // Handle nested error objects with comprehensive extraction
            if (message.message) errorString = String(message.message);
            else if (message.error) errorString = String(message.error);
            else if (message.userMessage) errorString = String(message.userMessage);
            else if (message.description) errorString = String(message.description);
            else if (message.details) errorString = String(message.details);
            else {
                // If it's an object but no recognizable message field, stringify it safely
                try {
                    errorString = JSON.stringify(message);
                } catch (e) {
                    return 'Validation error occurred (unable to parse error details)';
                }
            }
        } else {
            // Fallback - convert to string safely
            try {
                errorString = String(message);
            } catch (e) {
                return 'Validation error occurred';
            }
        }

        // Remove technical prefixes
        errorString = errorString.replace(/^Step\d+-/, '');

        // Try to match patterns and get translation
        for (const {pattern, translation} of this.patterns) {
            const matches = errorString.match(pattern);
            if (matches) {
                return translation(matches);
            }
        }

        return errorString;
    },

    /**
     * Get user-friendly error type from error code (Enhanced implementation)
     * @param {string} errorCode - The technical error code
     * @returns {string} User-friendly error type
     */
    getErrorType(errorCode) {
        if (!errorCode || errorCode === 'VALIDATION_ERROR') {
            return 'Validation Error';
        }

        // Use enhanced error codes mapping
        return this.errorCodes[errorCode] || errorCode;
    }
};

// Export for use in other files
window.ValidationTranslations = ValidationTranslations; 