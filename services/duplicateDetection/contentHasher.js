/**
 * Content Hasher Service
 * Generates content-based hashes for duplicate detection in e-invoice system
 */

const crypto = require('crypto');

class ContentHasher {
    /**
     * Generate a content hash from processed invoice data
     * @param {Array} processedInvoices - Array of processed invoice objects
     * @returns {string} SHA-256 hash of normalized invoice data
     */
    static generateInvoiceDataHash(processedInvoices) {
        if (!processedInvoices || !Array.isArray(processedInvoices) || processedInvoices.length === 0) {
            return null;
        }

        try {
            // Create normalized data for hashing
            const normalizedData = processedInvoices.map(invoice => {
                return {
                    invoiceNo: this.normalizeString(invoice.header?.invoiceNo),
                    supplierTin: this.normalizeString(invoice.parties?.supplier?.identifications?.TIN),
                    buyerTin: this.normalizeString(invoice.parties?.buyer?.identifications?.TIN),
                    invoiceDate: invoice.header?.invoiceDate,
                    totalAmount: this.normalizeAmount(invoice.summary?.amounts?.payableAmount),
                    lineItemsHash: this.hashLineItems(invoice.items),
                    currencyCode: invoice.header?.documentCurrencyCode || 'MYR'
                };
            }).sort((a, b) => a.invoiceNo.localeCompare(b.invoiceNo));

            const dataString = JSON.stringify(normalizedData);
            return crypto.createHash('sha256').update(dataString).digest('hex');
        } catch (error) {
            console.error('Error generating invoice data hash:', error);
            return null;
        }
    }

    /**
     * Generate hash for individual invoice (for invoice-level duplicate detection)
     * @param {Object} invoice - Single invoice object
     * @returns {string} MD5 hash of invoice key data
     */
    static generateInvoiceHash(invoice) {
        if (!invoice) return null;

        try {
            const invoiceKey = {
                invoiceNo: this.normalizeString(invoice.header?.invoiceNo),
                supplierTin: this.normalizeString(invoice.parties?.supplier?.identifications?.TIN),
                buyerTin: this.normalizeString(invoice.parties?.buyer?.identifications?.TIN),
                invoiceDate: invoice.header?.invoiceDate,
                totalAmount: this.normalizeAmount(invoice.summary?.amounts?.payableAmount)
            };

            const keyString = JSON.stringify(invoiceKey);
            return crypto.createHash('md5').update(keyString).digest('hex');
        } catch (error) {
            console.error('Error generating individual invoice hash:', error);
            return null;
        }
    }

    /**
     * Hash line items for more detailed duplicate detection
     * @param {Array} items - Array of line items
     * @returns {string} MD5 hash of line items
     */
    static hashLineItems(items) {
        if (!items || !Array.isArray(items) || items.length === 0) {
            return '';
        }

        try {
            const itemsData = items.map(item => ({
                description: this.normalizeString(item.description),
                quantity: this.normalizeAmount(item.quantity),
                unitPrice: this.normalizeAmount(item.unitPrice),
                amount: this.normalizeAmount(item.lineExtensionAmount),
                taxAmount: this.normalizeAmount(item.taxTotal?.taxAmount)
            })).sort((a, b) => a.description.localeCompare(b.description));

            return crypto.createHash('md5').update(JSON.stringify(itemsData)).digest('hex');
        } catch (error) {
            console.error('Error hashing line items:', error);
            return '';
        }
    }

    /**
     * Generate a simple file content hash (for basic file-level duplicate detection)
     * @param {Buffer|string} fileContent - File content buffer or string
     * @returns {string} SHA-256 hash of file content
     */
    static generateFileContentHash(fileContent) {
        if (!fileContent) return null;

        try {
            return crypto.createHash('sha256').update(fileContent).digest('hex');
        } catch (error) {
            console.error('Error generating file content hash:', error);
            return null;
        }
    }

    /**
     * Normalize string values for consistent hashing
     * @param {any} value - Value to normalize
     * @returns {string} Normalized string
     */
    static normalizeString(value) {
        if (value === null || value === undefined) return '';
        return String(value).trim().toUpperCase();
    }

    /**
     * Normalize numeric amounts for consistent hashing
     * @param {any} amount - Amount to normalize
     * @returns {number} Normalized amount
     */
    static normalizeAmount(amount) {
        if (amount === null || amount === undefined || amount === '') return 0;
        const parsed = parseFloat(amount);
        return isNaN(parsed) ? 0 : Math.round(parsed * 100) / 100; // Round to 2 decimal places
    }

    /**
     * Create a composite key for invoice identification
     * @param {Object} invoice - Invoice object
     * @returns {Object} Invoice key object
     */
    static createInvoiceKey(invoice) {
        return {
            invoiceNo: this.normalizeString(invoice.header?.invoiceNo),
            supplierTin: this.normalizeString(invoice.parties?.supplier?.identifications?.TIN),
            buyerTin: this.normalizeString(invoice.parties?.buyer?.identifications?.TIN),
            invoiceDate: invoice.header?.invoiceDate,
            totalAmount: this.normalizeAmount(invoice.summary?.amounts?.payableAmount),
            hash: this.generateInvoiceHash(invoice)
        };
    }

    /**
     * Validate if two invoice keys represent the same invoice
     * @param {Object} key1 - First invoice key
     * @param {Object} key2 - Second invoice key
     * @returns {boolean} True if keys match
     */
    static areInvoiceKeysEqual(key1, key2) {
        return key1.invoiceNo === key2.invoiceNo &&
               key1.supplierTin === key2.supplierTin &&
               key1.buyerTin === key2.buyerTin &&
               key1.invoiceDate === key2.invoiceDate &&
               Math.abs(key1.totalAmount - key2.totalAmount) < 0.01; // Allow small floating point differences
    }
}

module.exports = ContentHasher;
