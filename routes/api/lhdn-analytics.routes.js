const express = require('express');
const router = express.Router();
const prisma = require('../../src/lib/prisma');
const { auth } = require('../../middleware/index-prisma');
const moment = require('moment');

/**
 * Real-time LHDN Processing Analytics API
 * Tracks submission and validation timestamps for accurate processing time calculation
 */

// Get real-time processing analytics data
router.get('/processing-analytics', [auth.isApiAuthenticated], async (req, res) => {
    try {
        const { timeframe = 'today', limit = 50 } = req.query;
        
        // Calculate date range based on timeframe
        let startDate;

        switch (timeframe) {
            case 'today':
                startDate = moment().startOf('day').toDate();
                break;
            case 'weekly':
                startDate = moment().subtract(7, 'days').toDate();
                break;
            case '24h':
                startDate = moment().subtract(24, 'hours').toDate();
                break;
            case '7d':
                startDate = moment().subtract(7, 'days').toDate();
                break;
            case '30d':
                startDate = moment().subtract(30, 'days').toDate();
                break;
            default:
                startDate = moment().startOf('day').toDate();
        }

        // Get validated invoices with both submission and validation timestamps
        console.log(`[Analytics API] Fetching data for timeframe: ${timeframe}, startDate: ${startDate.toISOString()}`);
        console.log(`[Analytics API] User ID: ${req.user?.id}`);

        // First, get all valid records for this user to debug
        const allValidRecords = await prisma.wP_INBOUND_STATUS.findMany({
            where: {
                status: 'Valid',
                createdByUserId: req.user?.id?.toString()
            },
            select: {
                uuid: true,
                status: true,
                dateTimeReceived: true,
                dateTimeValidated: true,
                createdByUserId: true
            }
        });

        console.log(`[Analytics API] All valid records for user: ${allValidRecords.length}`);
        allValidRecords.forEach((record, index) => {
            console.log(`[Analytics API] Record ${index + 1}:`, {
                uuid: record.uuid,
                status: record.status,
                dateTimeReceived: record.dateTimeReceived,
                dateTimeValidated: record.dateTimeValidated,
                hasReceived: !!record.dateTimeReceived,
                hasValidated: !!record.dateTimeValidated
            });
        });

        // Now apply the full filter
        let whereClause = {
            status: 'Valid',
            createdByUserId: req.user?.id?.toString(),
            dateTimeReceived: {
                not: null,
                not: ''
            },
            dateTimeValidated: {
                not: null,
                not: ''
            }
        };

        // Add date filter for timeframe
        if (timeframe === 'today') {
            const todayStart = moment().startOf('day').format('YYYY-MM-DD HH:mm:ss');
            const todayEnd = moment().endOf('day').format('YYYY-MM-DD HH:mm:ss');
            console.log(`[Analytics API] Today filter: ${todayStart} to ${todayEnd}`);

            // For today, we need to check if dateTimeValidated falls within today
            // Since we don't know the exact format, let's be more flexible
            whereClause.dateTimeValidated = {
                gte: todayStart
            };
        } else {
            whereClause.dateTimeValidated = {
                gte: moment(startDate).format('YYYY-MM-DD HH:mm:ss')
            };
        }

        console.log(`[Analytics API] Where clause:`, JSON.stringify(whereClause, null, 2));

        const validatedInvoices = await prisma.wP_INBOUND_STATUS.findMany({
            where: whereClause,
            orderBy: {
                dateTimeValidated: 'desc'
            },
            take: parseInt(limit)
        });

        console.log(`[Analytics API] Found ${validatedInvoices.length} validated invoices after filtering`);

        // Calculate processing times
        const processingTimes = validatedInvoices.map((invoice, index) => {
            try {
                console.log(`[Analytics] Processing invoice ${index + 1}/${validatedInvoices.length}: ${invoice.uuid}`);
                console.log(`[Analytics] Raw timestamps - Received: "${invoice.dateTimeReceived}", Validated: "${invoice.dateTimeValidated}"`);

                // Parse timestamps - handle multiple formats
                const receivedTime = parseTimestamp(invoice.dateTimeReceived);
                const validatedTime = parseTimestamp(invoice.dateTimeValidated);

                console.log(`[Analytics] Parsed timestamps - Received: ${receivedTime}, Validated: ${validatedTime}`);

                if (!receivedTime || !validatedTime) {
                    console.warn(`[Analytics] Invalid timestamps for invoice ${invoice.uuid}: received=${invoice.dateTimeReceived}, validated=${invoice.dateTimeValidated}`);
                    return null;
                }

                const processingMs = validatedTime.getTime() - receivedTime.getTime();
                const processingHours = processingMs / (1000 * 60 * 60);
                const processingMinutes = processingMs / (1000 * 60);

                console.log(`[Analytics] Processing time for ${invoice.uuid}: ${processingMs}ms (${processingHours}h, ${processingMinutes}m)`);

                // Filter out invalid processing times (negative or > 1 week)
                if (processingMs < 0 || processingHours > 168) {
                    console.warn(`[Analytics] Invalid processing time for invoice ${invoice.uuid}: ${processingHours} hours`);
                    return null;
                }

                const result = {
                    uuid: invoice.uuid,
                    internalId: invoice.internalId || invoice.uuid,
                    submissionTime: receivedTime,
                    validationTime: validatedTime,
                    processingTimeMs: Math.max(0, processingMs),
                    processingTimeHours: Math.max(0, processingHours),
                    processingTimeMinutes: Math.max(0, processingMinutes),
                    status: invoice.status,
                    totalSales: invoice.totalSales || 0
                };

                console.log(`[Analytics] Successfully processed invoice ${invoice.uuid}:`, result);
                return result;
            } catch (error) {
                console.error(`[Analytics] Error processing invoice ${invoice.uuid}:`, error);
                return null;
            }
        }).filter(Boolean);

        console.log(`[Analytics API] Calculated processing times for ${processingTimes.length} invoices`);

        // Calculate statistics
        const stats = calculateProcessingStats(processingTimes, timeframe);

        // Get currently processing invoices
        const currentlyProcessing = await getCurrentlyProcessingInvoices(req.user.id);

        res.json({
            success: true,
            data: {
                processingTimes,
                statistics: stats,
                currentlyProcessing,
                timeframe,
                totalRecords: processingTimes.length,
                lastUpdated: new Date().toISOString()
            }
        });

    } catch (error) {
        console.error('Error fetching processing analytics:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch processing analytics',
            details: error.message
        });
    }
});

// Get real-time queue status with processing times
router.get('/queue-status', [auth.isApiAuthenticated], async (req, res) => {
    try {
        console.log(`[Queue API] Fetching queue status for user: ${req.user?.id}`);

        // Get invoices currently in queue (submitted but not validated)
        const queuedInvoices = await prisma.wP_INBOUND_STATUS.findMany({
            where: {
                status: { in: ['Submitted', 'Pending', 'Processing'] },
                createdByUserId: req.user?.id?.toString(),
                dateTimeReceived: { not: null },
                OR: [
                    { dateTimeValidated: null },
                    { dateTimeValidated: '' }
                ]
            },
            orderBy: {
                dateTimeReceived: 'asc'
            },
            take: 20 // Limit to prevent large responses
        });

        console.log(`[Queue API] Found ${queuedInvoices.length} queued invoices`);

        // Calculate current processing times for queued items
        const queueWithTimes = queuedInvoices.map((invoice, index) => {
            try {
                const submissionTime = parseTimestamp(invoice.dateTimeReceived);
                const now = new Date();

                if (!submissionTime) {
                    console.warn(`[Queue] Invalid submission time for invoice ${invoice.uuid}: ${invoice.dateTimeReceived}`);
                    return null;
                }

                const currentProcessingMs = Math.max(0, now.getTime() - submissionTime.getTime());
                const currentProcessingMinutes = currentProcessingMs / (1000 * 60);

                return {
                    uuid: invoice.uuid,
                    internalId: invoice.internalId || invoice.uuid,
                    status: invoice.status,
                    submissionTime: submissionTime.toISOString(),
                    currentProcessingTime: {
                        ms: currentProcessingMs,
                        minutes: currentProcessingMinutes,
                        hours: currentProcessingMs / (1000 * 60 * 60),
                        formatted: formatProcessingTime(currentProcessingMs, 'weekly')
                    },
                    queuePosition: index + 1,
                    estimatedCompletion: estimateCompletionTime(currentProcessingMinutes)
                };
            } catch (error) {
                console.error(`[Queue] Error processing invoice ${invoice.uuid}:`, error);
                return null;
            }
        }).filter(Boolean);

        console.log(`[Queue API] Processed ${queueWithTimes.length} queue items with times`);

        res.json({
            success: true,
            data: {
                queue: queueWithTimes,
                totalQueued: queueWithTimes.length,
                lastUpdated: new Date().toISOString()
            }
        });

    } catch (error) {
        console.error('Error fetching queue status:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch queue status',
            details: error.message
        });
    }
});



// Helper functions
function parseTimestamp(timestamp) {
    if (!timestamp || timestamp === '' || timestamp === 'null') return null;

    try {
        // Clean the timestamp string
        const cleanTimestamp = timestamp.toString().trim();

        // Try moment parsing with multiple formats
        const formats = [
            'YYYY-MM-DD HH:mm:ss',
            'YYYY-MM-DDTHH:mm:ss.SSSZ',
            'YYYY-MM-DDTHH:mm:ssZ',
            'YYYY-MM-DD HH:mm:ss.SSS',
            'MM/DD/YYYY HH:mm:ss',
            'DD/MM/YYYY HH:mm:ss'
        ];

        for (const format of formats) {
            const parsed = moment(cleanTimestamp, format, true);
            if (parsed.isValid()) {
                return parsed.toDate();
            }
        }

        // Try moment without strict parsing
        const momentParsed = moment(cleanTimestamp);
        if (momentParsed.isValid()) {
            return momentParsed.toDate();
        }

        // Fallback to native Date parsing
        const date = new Date(cleanTimestamp);
        if (!isNaN(date.getTime()) && date.getFullYear() > 1900) {
            return date;
        }

        console.warn(`[Analytics] Could not parse timestamp: ${timestamp}`);
        return null;
    } catch (error) {
        console.error(`[Analytics] Error parsing timestamp ${timestamp}:`, error);
        return null;
    }
}

function calculateProcessingStats(processingTimes, timeframe = 'weekly') {
    if (processingTimes.length === 0) {
        return {
            averageHours: 0,
            averageMinutes: 0,
            averageSeconds: 0,
            fastestHours: 0,
            fastestMinutes: 0,
            fastestSeconds: 0,
            slowestHours: 0,
            slowestMinutes: 0,
            slowestSeconds: 0,
            totalProcessed: 0,
            timeframe: timeframe
        };
    }

    const times = processingTimes.map(pt => pt.processingTimeHours);
    const timeMinutes = processingTimes.map(pt => pt.processingTimeMinutes);
    const timeSeconds = processingTimes.map(pt => pt.processingTimeMs / 1000);

    const average = times.reduce((a, b) => a + b, 0) / times.length;
    const fastest = Math.min(...times);
    const slowest = Math.max(...times);

    const averageMinutes = timeMinutes.reduce((a, b) => a + b, 0) / timeMinutes.length;
    const fastestMinutes = Math.min(...timeMinutes);
    const slowestMinutes = Math.max(...timeMinutes);

    const averageSeconds = timeSeconds.reduce((a, b) => a + b, 0) / timeSeconds.length;
    const fastestSeconds = Math.min(...timeSeconds);
    const slowestSeconds = Math.max(...timeSeconds);

    return {
        averageHours: average,
        averageMinutes: averageMinutes,
        averageSeconds: averageSeconds,
        fastestHours: fastest,
        fastestMinutes: fastestMinutes,
        fastestSeconds: fastestSeconds,
        slowestHours: slowest,
        slowestMinutes: slowestMinutes,
        slowestSeconds: slowestSeconds,
        totalProcessed: processingTimes.length,
        timeframe: timeframe
    };
}

async function getCurrentlyProcessingInvoices(userId) {
    try {
        const processing = await prisma.wP_INBOUND_STATUS.findMany({
            where: {
                status: { in: ['Submitted', 'Pending'] },
                createdByUserId: userId,
                dateTimeReceived: { not: null },
                dateTimeValidated: null
            },
            select: {
                uuid: true,
                internalId: true,
                status: true,
                dateTimeReceived: true
            }
        });

        return processing.map(invoice => {
            const submissionTime = parseTimestamp(invoice.dateTimeReceived);
            const currentTime = new Date();
            const processingMs = submissionTime ? currentTime.getTime() - submissionTime.getTime() : 0;

            return {
                uuid: invoice.uuid,
                internalId: invoice.internalId,
                status: invoice.status,
                currentProcessingTime: formatProcessingTime(processingMs),
                submissionTime: submissionTime?.toISOString()
            };
        });
    } catch (error) {
        console.error('Error getting currently processing invoices:', error);
        return [];
    }
}

function formatProcessingTime(milliseconds, timeframe = 'weekly') {
    const seconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    // For today view, use granular formatting
    if (timeframe === 'today') {
        if (seconds < 1) {
            return '<1sec';
        } else if (seconds < 60) {
            return '<1min';
        } else if (minutes < 30) {
            return '<30min';
        } else {
            return '>1hr';
        }
    }

    // For weekly and other views, use standard formatting
    if (seconds < 60) {
        return `${seconds}s`;
    } else if (minutes < 60) {
        return `${minutes}m ${seconds % 60}s`;
    } else if (hours < 24) {
        return `${hours}h ${minutes % 60}m`;
    } else {
        return `${days}d ${hours % 24}h`;
    }
}

function estimateCompletionTime(currentMinutes) {
    // Simple estimation based on current processing time
    // This could be enhanced with historical data
    const averageProcessingMinutes = 120; // 2 hours average
    const remainingMinutes = Math.max(0, averageProcessingMinutes - currentMinutes);
    
    return {
        estimatedRemainingMinutes: remainingMinutes,
        estimatedCompletionTime: new Date(Date.now() + remainingMinutes * 60 * 1000).toISOString(),
        formatted: formatProcessingTime(remainingMinutes * 60 * 1000)
    };
}

// Test endpoint for debugging
router.get('/test', [auth.isApiAuthenticated], async (req, res) => {
    try {
        console.log(`[Analytics Test] Testing database connection for user: ${req.user?.id}`);

        // Test basic database connection
        const totalRecords = await prisma.wP_INBOUND_STATUS.count();
        console.log(`[Analytics Test] Total records in WP_INBOUND_STATUS: ${totalRecords}`);

        // Test user-specific records
        const userRecords = await prisma.wP_INBOUND_STATUS.count({
            where: {
                createdByUserId: req.user?.id?.toString()
            }
        });
        console.log(`[Analytics Test] User records: ${userRecords}`);

        // Test valid records
        const validRecords = await prisma.wP_INBOUND_STATUS.count({
            where: {
                status: 'Valid',
                createdByUserId: req.user?.id?.toString()
            }
        });
        console.log(`[Analytics Test] Valid records: ${validRecords}`);

        // Test records with timestamps
        const recordsWithTimestamps = await prisma.wP_INBOUND_STATUS.count({
            where: {
                status: 'Valid',
                dateTimeReceived: { not: null },
                dateTimeValidated: { not: null },
                createdByUserId: req.user?.id?.toString()
            }
        });
        console.log(`[Analytics Test] Records with timestamps: ${recordsWithTimestamps}`);

        // Get sample records with more details
        const sampleRecords = await prisma.wP_INBOUND_STATUS.findMany({
            where: {
                createdByUserId: req.user?.id?.toString()
            },
            take: 5,
            select: {
                uuid: true,
                status: true,
                dateTimeReceived: true,
                dateTimeValidated: true,
                createdByUserId: true,
                internalId: true
            }
        });

        // Test today's records specifically
        const todayStart = moment().startOf('day').format('YYYY-MM-DD HH:mm:ss');
        const todayRecords = await prisma.wP_INBOUND_STATUS.findMany({
            where: {
                createdByUserId: req.user?.id?.toString(),
                dateTimeValidated: {
                    gte: todayStart
                }
            },
            take: 10,
            select: {
                uuid: true,
                status: true,
                dateTimeReceived: true,
                dateTimeValidated: true,
                createdByUserId: true
            }
        });

        // Test records with valid timestamps
        const recordsWithValidTimestamps = await prisma.wP_INBOUND_STATUS.findMany({
            where: {
                status: 'Valid',
                dateTimeReceived: { not: null },
                dateTimeValidated: { not: null },
                createdByUserId: req.user?.id?.toString()
            },
            take: 10,
            select: {
                uuid: true,
                status: true,
                dateTimeReceived: true,
                dateTimeValidated: true,
                createdByUserId: true
            }
        });

        res.json({
            success: true,
            data: {
                totalRecords,
                userRecords,
                validRecords,
                recordsWithTimestamps,
                sampleRecords,
                todayRecords,
                recordsWithValidTimestamps,
                userId: req.user?.id,
                todayStart
            }
        });

    } catch (error) {
        console.error('[Analytics Test] Error:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            stack: error.stack
        });
    }
});

module.exports = router;
