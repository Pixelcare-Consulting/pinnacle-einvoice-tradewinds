/**
 * Manual Outbound duplicate detection — scoped to WP_UPLOADED_EXCEL_FILES only.
 * Team-wide checks for submitted rows; skips WP_OUTBOUND_STATUS.
 */

const prisma = require('../../src/lib/prisma');
const ContentHasher = require('./contentHasher');
const InvoiceDuplicateChecker = require('./invoiceDuplicateChecker');

class ManualDuplicateService {
    static parseMetadata(raw) {
        try {
            return typeof raw === 'string' ? JSON.parse(raw) : raw || {};
        } catch {
            return {};
        }
    }

    static fileContainsInvoice(metadata, invoiceNo) {
        if (!invoiceNo) return false;
        if (metadata?.invoiceHashes?.[invoiceNo]) return true;
        const list = metadata?.listInvoiceDetails || [];
        if (
            list.some(
                (inv) => (inv.invoiceNumber || inv.invoiceNo) === invoiceNo
            )
        ) {
            return true;
        }
        const prepared = metadata?.prepared?.invoiceNumbers || [];
        return prepared.includes(invoiceNo);
    }

    /**
     * Team-wide: find a submitted excel row containing this invoice number.
     */
    static async checkAgainstManualExcelSubmissions(
        invoiceKey,
        excludeFileId = null
    ) {
        const submittedFiles = await prisma.wP_UPLOADED_EXCEL_FILES.findMany({
            where: {
                processing_status: 'submitted',
                ...(excludeFileId ? { id: { not: excludeFileId } } : {}),
            },
            select: {
                id: true,
                filename: true,
                submitted_date: true,
                uploaded_by_name: true,
                uploaded_by_user_id: true,
                metadata: true,
            },
        });

        for (const file of submittedFiles) {
            const metadata = this.parseMetadata(file.metadata);
            if (this.fileContainsInvoice(metadata, invoiceKey.invoiceNo)) {
                return {
                    id: file.id,
                    filename: file.filename,
                    submitted_date: file.submitted_date,
                    uploaded_by_name: file.uploaded_by_name,
                    uploaded_by_user_id: file.uploaded_by_user_id,
                };
            }
        }
        return null;
    }

    static async checkAgainstRecentUploadsTeamWide(
        invoiceKey,
        currentFileId = null
    ) {
        const recentCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const recentFiles = await prisma.wP_UPLOADED_EXCEL_FILES.findMany({
            where: {
                upload_date: { gte: recentCutoff },
                processing_status: { not: 'error' },
                id: currentFileId ? { not: currentFileId } : undefined,
            },
            select: {
                id: true,
                filename: true,
                upload_date: true,
                processing_status: true,
                uploaded_by_name: true,
                metadata: true,
            },
        });

        const matchingFiles = [];
        for (const file of recentFiles) {
            const metadata = this.parseMetadata(file.metadata);
            if (this.fileContainsInvoice(metadata, invoiceKey.invoiceNo)) {
                matchingFiles.push({
                    ...file,
                    matchType: 'INVOICE_NUMBER_MATCH',
                });
            }
        }
        return matchingFiles;
    }

    /**
     * Manual-scoped duplicate check for upload flow (team-wide submitted rows).
     */
    static async checkManualInvoiceDuplicates(
        invoices,
        currentUserId,
        currentFileId = null
    ) {
        const duplicates = [];
        const warnings = [];
        const invoiceKeys = [];

        for (let i = 0; i < invoices.length; i++) {
            const invoice = invoices[i];
            const invoiceKey = ContentHasher.createInvoiceKey(invoice);
            if (!invoiceKey.invoiceNo) continue;
            invoiceKeys.push(invoiceKey);

            try {
                const existingInvoice =
                    await InvoiceDuplicateChecker.checkAgainstFlatFile(
                        invoiceKey
                    );
                if (existingInvoice) {
                    duplicates.push({
                        invoiceNo: invoiceKey.invoiceNo,
                        duplicateType: 'PROCESSED_INVOICE',
                        severity: 'HIGH',
                        source: 'WP_FLATFILE',
                        existingRecord: existingInvoice,
                        message: `Invoice ${invoiceKey.invoiceNo} already exists in processed invoices`,
                    });
                }

                const manualSubmission =
                    await this.checkAgainstManualExcelSubmissions(
                        invoiceKey,
                        currentFileId
                    );
                if (manualSubmission) {
                    const submittedOn = manualSubmission.submitted_date
                        ? new Date(
                              manualSubmission.submitted_date
                          ).toLocaleDateString('en-MY')
                        : 'unknown date';
                    duplicates.push({
                        invoiceNo: invoiceKey.invoiceNo,
                        duplicateType: 'ALREADY_SUBMITTED',
                        severity: 'CRITICAL',
                        source: 'WP_UPLOADED_EXCEL_FILES',
                        existingSubmission: manualSubmission,
                        message: `Invoice ${invoiceKey.invoiceNo} was already submitted in "${manualSubmission.filename}" (row ${manualSubmission.id}) on ${submittedOn}`,
                    });
                }

                const lhdnRecord =
                    await InvoiceDuplicateChecker.checkAgainstInboundStatus(
                        invoiceKey
                    );
                if (lhdnRecord) {
                    duplicates.push({
                        invoiceNo: invoiceKey.invoiceNo,
                        duplicateType: 'LHDN_RECORD',
                        severity: 'CRITICAL',
                        source: 'WP_INBOUND_STATUS',
                        existingLhdnRecord: lhdnRecord,
                        message: `Invoice ${invoiceKey.invoiceNo} found in LHDN records`,
                    });
                }

                const recentUploads =
                    await this.checkAgainstRecentUploadsTeamWide(
                        invoiceKey,
                        currentFileId
                    );
                if (recentUploads.length > 0) {
                    warnings.push({
                        invoiceNo: invoiceKey.invoiceNo,
                        duplicateType: 'RECENT_UPLOAD',
                        severity: 'MEDIUM',
                        source: 'WP_UPLOADED_EXCEL_FILES',
                        recentFiles: recentUploads,
                        message: `Invoice ${invoiceKey.invoiceNo} found in recent uploads`,
                    });
                }

                const similarInvoices =
                    await InvoiceDuplicateChecker.findSimilarInvoices(
                        invoiceKey
                    );
                if (similarInvoices.length > 0) {
                    warnings.push({
                        invoiceNo: invoiceKey.invoiceNo,
                        duplicateType: 'SIMILAR_INVOICE',
                        severity: 'LOW',
                        source: 'SIMILARITY_CHECK',
                        similarInvoices,
                        message: `Found ${similarInvoices.length} similar invoices for ${invoiceKey.invoiceNo}`,
                    });
                }
            } catch (error) {
                console.error(
                    `[Manual Duplicate] Error checking invoice ${invoiceKey.invoiceNo}:`,
                    error
                );
                warnings.push({
                    invoiceNo: invoiceKey.invoiceNo,
                    duplicateType: 'CHECK_ERROR',
                    severity: 'LOW',
                    source: 'ERROR',
                    error: error.message,
                    message: `Error occurred while checking invoice ${invoiceKey.invoiceNo}`,
                });
            }
        }

        const internalDuplicates =
            InvoiceDuplicateChecker.checkInternalDuplicates(invoiceKeys);
        duplicates.push(...internalDuplicates);

        const result = {
            duplicates,
            warnings,
            summary: {
                totalInvoices: invoices.length,
                duplicateCount: duplicates.length,
                warningCount: warnings.length,
                criticalDuplicates: duplicates.filter(
                    (d) => d.severity === 'CRITICAL'
                ).length,
                highDuplicates: duplicates.filter((d) => d.severity === 'HIGH')
                    .length,
                hasBlockingDuplicates: duplicates.some((d) =>
                    ['CRITICAL', 'HIGH'].includes(d.severity)
                ),
            },
        };

        console.log(`[Manual Duplicate] Results:`, result.summary);
        return result;
    }

    /**
     * Pre-submit duplicate check for a prepared file (team-wide submitted rows).
     */
    static async checkPreparedInvoiceNumbers(
        invoiceNumbers,
        excludeFileId = null
    ) {
        const duplicates = [];
        const warnings = [];

        for (const invoiceNo of invoiceNumbers) {
            const invoiceKey = { invoiceNo };
            const manualSubmission =
                await this.checkAgainstManualExcelSubmissions(
                    invoiceKey,
                    excludeFileId
                );
            if (manualSubmission) {
                duplicates.push({
                    invoiceNumber: invoiceNo,
                    status: 'submitted',
                    dateSubmitted: manualSubmission.submitted_date,
                    source: 'WP_UPLOADED_EXCEL_FILES',
                    severity: 'error',
                    blockingFileId: manualSubmission.id,
                    blockingFilename: manualSubmission.filename,
                    uploadedBy: manualSubmission.uploaded_by_name,
                    message: `Invoice ${invoiceNo} was already submitted in "${manualSubmission.filename}" (row ${manualSubmission.id})`,
                });
            }
        }

        const recentCutoff = new Date(Date.now() - 10 * 60 * 1000);
        const recentSubmissions =
            await prisma.wP_UPLOADED_EXCEL_FILES.findMany({
                where: {
                    submitted_date: { gte: recentCutoff },
                    processing_status: 'submitted',
                    id: excludeFileId ? { not: excludeFileId } : undefined,
                },
                select: {
                    id: true,
                    filename: true,
                    submitted_date: true,
                    uploaded_by_name: true,
                    metadata: true,
                },
            });

        for (const recent of recentSubmissions) {
            const metadata = this.parseMetadata(recent.metadata);
            const recentInvoices = metadata?.prepared?.invoiceNumbers || [];
            const listInvoices = (metadata?.listInvoiceDetails || []).map(
                (inv) => inv.invoiceNumber || inv.invoiceNo
            );
            const hashInvoices = Object.keys(metadata?.invoiceHashes || {});
            const allRecent = [
                ...new Set([
                    ...recentInvoices,
                    ...listInvoices,
                    ...hashInvoices,
                ]),
            ];
            const overlap = invoiceNumbers.filter((inv) =>
                allRecent.includes(inv)
            );
            if (overlap.length > 0) {
                warnings.push({
                    type: 'recent_submission',
                    message: `Similar invoices submitted recently in file: ${recent.filename} (row ${recent.id})`,
                    invoiceNumbers: overlap,
                    submittedAt: recent.submitted_date,
                    uploadedBy: recent.uploaded_by_name,
                });
            }
        }

        return { duplicates, warnings };
    }
}

module.exports = ManualDuplicateService;
