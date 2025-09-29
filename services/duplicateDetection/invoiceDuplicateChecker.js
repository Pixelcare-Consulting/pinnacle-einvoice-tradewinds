/**
 * Invoice Duplicate Checker Service
 * Comprehensive duplicate detection for e-invoice system
 */

const prisma = require('../../src/lib/prisma');
const ContentHasher = require('./contentHasher');

class InvoiceDuplicateChecker {
    /**
     * Check for invoice duplicates across multiple sources
     * @param {Array} invoices - Array of invoice objects to check
     * @param {number} currentUserId - ID of current user
     * @param {number} currentFileId - ID of current file (to exclude from checks)
     * @returns {Object} Duplicate check results
     */
    static async checkInvoiceDuplicates(invoices, currentUserId, currentFileId = null) {
        const duplicates = [];
        const warnings = [];
        const invoiceKeys = [];

        console.log(`[Duplicate Checker] Checking ${invoices.length} invoices for duplicates`);

        for (let i = 0; i < invoices.length; i++) {
            const invoice = invoices[i];
            const invoiceKey = ContentHasher.createInvoiceKey(invoice);
            
            if (!invoiceKey.invoiceNo) {
                console.warn(`[Duplicate Checker] Skipping invoice ${i + 1}: No invoice number found`);
                continue;
            }

            invoiceKeys.push(invoiceKey);

            try {
                // Check 1: Against WP_FLATFILE (processed invoices)
                const existingInvoice = await this.checkAgainstFlatFile(invoiceKey);
                if (existingInvoice) {
                    duplicates.push({
                        invoiceNo: invoiceKey.invoiceNo,
                        duplicateType: 'PROCESSED_INVOICE',
                        severity: 'HIGH',
                        source: 'WP_FLATFILE',
                        existingRecord: existingInvoice,
                        message: `Invoice ${invoiceKey.invoiceNo} already exists in processed invoices`
                    });
                }

                // Check 2: Against WP_OUTBOUND_STATUS (submitted invoices)
                const submittedInvoice = await this.checkAgainstOutboundStatus(invoiceKey);
                if (submittedInvoice) {
                    duplicates.push({
                        invoiceNo: invoiceKey.invoiceNo,
                        duplicateType: 'ALREADY_SUBMITTED',
                        severity: 'CRITICAL',
                        source: 'WP_OUTBOUND_STATUS',
                        existingSubmission: submittedInvoice,
                        message: `Invoice ${invoiceKey.invoiceNo} has already been submitted to LHDN`
                    });
                }

                // Check 3: Against WP_INBOUND_STATUS (LHDN records)
                const lhdnRecord = await this.checkAgainstInboundStatus(invoiceKey);
                if (lhdnRecord) {
                    duplicates.push({
                        invoiceNo: invoiceKey.invoiceNo,
                        duplicateType: 'LHDN_RECORD',
                        severity: 'CRITICAL',
                        source: 'WP_INBOUND_STATUS',
                        existingLhdnRecord: lhdnRecord,
                        message: `Invoice ${invoiceKey.invoiceNo} found in LHDN records`
                    });
                }

                // Check 4: Against recent uploads (same user, different files)
                const recentUploads = await this.checkAgainstRecentUploads(invoiceKey, currentUserId, currentFileId);
                if (recentUploads.length > 0) {
                    warnings.push({
                        invoiceNo: invoiceKey.invoiceNo,
                        duplicateType: 'RECENT_UPLOAD',
                        severity: 'MEDIUM',
                        source: 'WP_UPLOADED_EXCEL_FILES',
                        recentFiles: recentUploads,
                        message: `Invoice ${invoiceKey.invoiceNo} found in recent uploads`
                    });
                }

                // Check 5: Similar invoices (fuzzy matching)
                const similarInvoices = await this.findSimilarInvoices(invoiceKey);
                if (similarInvoices.length > 0) {
                    warnings.push({
                        invoiceNo: invoiceKey.invoiceNo,
                        duplicateType: 'SIMILAR_INVOICE',
                        severity: 'LOW',
                        source: 'SIMILARITY_CHECK',
                        similarInvoices,
                        message: `Found ${similarInvoices.length} similar invoices for ${invoiceKey.invoiceNo}`
                    });
                }

            } catch (error) {
                console.error(`[Duplicate Checker] Error checking invoice ${invoiceKey.invoiceNo}:`, error);
                warnings.push({
                    invoiceNo: invoiceKey.invoiceNo,
                    duplicateType: 'CHECK_ERROR',
                    severity: 'LOW',
                    source: 'ERROR',
                    error: error.message,
                    message: `Error occurred while checking invoice ${invoiceKey.invoiceNo}`
                });
            }
        }

        // Check for internal duplicates (within the same file)
        const internalDuplicates = this.checkInternalDuplicates(invoiceKeys);
        duplicates.push(...internalDuplicates);

        const result = {
            duplicates,
            warnings,
            summary: {
                totalInvoices: invoices.length,
                duplicateCount: duplicates.length,
                warningCount: warnings.length,
                criticalDuplicates: duplicates.filter(d => d.severity === 'CRITICAL').length,
                highDuplicates: duplicates.filter(d => d.severity === 'HIGH').length,
                hasBlockingDuplicates: duplicates.some(d => ['CRITICAL', 'HIGH'].includes(d.severity))
            }
        };

        console.log(`[Duplicate Checker] Results:`, result.summary);
        return result;
    }

    /**
     * Check against WP_FLATFILE table
     */
    static async checkAgainstFlatFile(invoiceKey) {
        return await prisma.wP_FLATFILE.findFirst({
            where: {
                invoice_no: invoiceKey.invoiceNo,
                supplier_tin: invoiceKey.supplierTin,
                buyer_tin: invoiceKey.buyerTin,
                invoice_date: invoiceKey.invoiceDate ? new Date(invoiceKey.invoiceDate) : undefined
            },
            select: {
                id: true,
                invoice_no: true,
                supplier_tin: true,
                buyer_tin: true,
                invoice_date: true,
                total_incl_tax: true,
                upload_date: true,
                status: true
            }
        });
    }

    /**
     * Check against WP_OUTBOUND_STATUS table
     */
    static async checkAgainstOutboundStatus(invoiceKey) {
        return await prisma.wP_OUTBOUND_STATUS.findFirst({
            where: {
                invoice_number: invoiceKey.invoiceNo,
                status: { not: 'Cancelled' }
            },
            select: {
                id: true,
                invoice_number: true,
                submissionUid: true,
                status: true,
                date_submitted: true,
                company: true,
                supplier: true,
                receiver: true
            }
        });
    }

    /**
     * Check against WP_INBOUND_STATUS table
     */
    static async checkAgainstInboundStatus(invoiceKey) {
        return await prisma.wP_INBOUND_STATUS.findFirst({
            where: {
                internalId: invoiceKey.invoiceNo,
                status: { not: 'Cancelled' }
            },
            select: {
                uuid: true,
                submissionUid: true,
                internalId: true,
                status: true,
                dateTimeReceived: true,
                issuerTin: true,
                issuerName: true,
                receiverId: true,
                receiverName: true
            }
        });
    }

    /**
     * Check against recent uploads by same user
     */
    static async checkAgainstRecentUploads(invoiceKey, currentUserId, currentFileId) {
        const recentCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24 hours ago

        const recentFiles = await prisma.wP_UPLOADED_EXCEL_FILES.findMany({
            where: {
                uploaded_by_user_id: currentUserId,
                upload_date: { gte: recentCutoff },
                processing_status: { not: 'error' },
                id: currentFileId ? { not: currentFileId } : undefined
            },
            select: {
                id: true,
                filename: true,
                upload_date: true,
                processing_status: true,
                metadata: true
            }
        });

        // Check if any recent files contain the same invoice
        const matchingFiles = [];
        for (const file of recentFiles) {
            try {
                const metadata = typeof file.metadata === 'string' ? JSON.parse(file.metadata) : file.metadata;
                const invoiceHashes = metadata?.invoiceHashes || {};
                
                if (invoiceHashes[invoiceKey.invoiceNo]) {
                    matchingFiles.push({
                        ...file,
                        matchType: 'INVOICE_NUMBER_MATCH'
                    });
                }
            } catch (error) {
                console.warn(`[Duplicate Checker] Error parsing metadata for file ${file.id}:`, error);
            }
        }

        return matchingFiles;
    }

    /**
     * Find similar invoices (fuzzy matching)
     */
    static async findSimilarInvoices(invoiceKey) {
        // Find invoices with same supplier/buyer but different invoice numbers
        // or same invoice number but different suppliers/amounts
        const similarInvoices = await prisma.wP_FLATFILE.findMany({
            where: {
                OR: [
                    // Same parties, same date, different invoice number
                    {
                        supplier_tin: invoiceKey.supplierTin,
                        buyer_tin: invoiceKey.buyerTin,
                        invoice_date: invoiceKey.invoiceDate ? new Date(invoiceKey.invoiceDate) : undefined,
                        invoice_no: { not: invoiceKey.invoiceNo }
                    },
                    // Same invoice number, different parties
                    {
                        invoice_no: invoiceKey.invoiceNo,
                        OR: [
                            { supplier_tin: { not: invoiceKey.supplierTin } },
                            { buyer_tin: { not: invoiceKey.buyerTin } }
                        ]
                    }
                ]
            },
            select: {
                id: true,
                invoice_no: true,
                supplier_tin: true,
                buyer_tin: true,
                invoice_date: true,
                total_incl_tax: true
            },
            take: 5
        });

        return similarInvoices;
    }

    /**
     * Check for duplicates within the same file
     */
    static checkInternalDuplicates(invoiceKeys) {
        const duplicates = [];
        const seen = new Map();

        for (const key of invoiceKeys) {
            const keyString = `${key.invoiceNo}_${key.supplierTin}_${key.buyerTin}`;
            
            if (seen.has(keyString)) {
                duplicates.push({
                    invoiceNo: key.invoiceNo,
                    duplicateType: 'INTERNAL_DUPLICATE',
                    severity: 'HIGH',
                    source: 'SAME_FILE',
                    message: `Invoice ${key.invoiceNo} appears multiple times in the same file`,
                    firstOccurrence: seen.get(keyString),
                    currentOccurrence: key
                });
            } else {
                seen.set(keyString, key);
            }
        }

        return duplicates;
    }
}

module.exports = InvoiceDuplicateChecker;
