const express = require("express");
const router = express.Router();
const axios = require("axios");
const NodeCache = require("node-cache");
const path = require("path");
const fs = require("fs");
const fsPromises = fs.promises;
const jsrender = require("jsrender");
const QRCode = require("qrcode");
const pdfGenerationService = require("../../services/pdf-generation.service");
const { logger, apiLogger, versionLogger } = require("../../utils/logger");
const { getUnitType } = require("../../utils/UOM");
const { getInvoiceTypes } = require("../../utils/EInvoiceTypes");
const axiosRetry = require("axios-retry");
const moment = require("moment");
// Import LHDN error mapping utilities
const { formatLHDNError } = require("../../utils/lhdnErrorHandler");

// Load the existing comprehensive LHDNErrorMapper
let LHDNErrorMapper;
try {
  const lhdnErrorMappingPath = path.join(__dirname, '../../public/assets/utils/lhdnErrorMapping.js');
  const lhdnErrorMappingCode = fs.readFileSync(lhdnErrorMappingPath, 'utf8');

  // Create a minimal environment to execute the mapping code
  const vm = require('vm');
  const context = {
    window: {},
    module: { exports: {} },
    console: console
  };
  vm.createContext(context);
  vm.runInContext(lhdnErrorMappingCode, context);

  LHDNErrorMapper = context.module.exports || context.window.LHDNErrorMapper;
  // console.log('Successfully loaded comprehensive LHDNErrorMapper with', Object.keys(new LHDNErrorMapper().errorCodeMap).length, 'error codes');
} catch (error) {
  console.error('Failed to load LHDNErrorMapper:', error);
  // Fallback to a simple error mapper
  LHDNErrorMapper = class {
    mapError(code, message) {
      return {
        code,
        userMessage: message || 'Validation error occurred',
        technicalMessage: message,
        guidance: ['Please check the document and try again'],
        severity: 'error'
      };
    }

    parseLHDNValidationError(error) {
      return [{
        code: 'VALIDATION_ERROR',
        userMessage: error.message || 'Validation error occurred',
        technicalMessage: error.message,
        guidance: ['Please check the document and try again'],
        severity: 'error'
      }];
    }
  };
}

// Create instance of the comprehensive LHDN error mapper
const lhdnErrorMapper = new LHDNErrorMapper();

// Initialize LHDN cache with custom configuration
const lhdnCache = {
  storage: new NodeCache({ 
    stdTTL: 900, // 15 minutes default TTL
    checkperiod: 120, // Check for expired keys every 2 minutes
    useClones: false // For better performance
  }),
  
  get(type, key, userId) {
    const cacheKey = `${type}:${key}:${userId || 'global'}`;
    return this.storage.get(cacheKey);
  },
  
  set(type, key, value, userId, ttl = 900) {
    const cacheKey = `${type}:${key}:${userId || 'global'}`;
    return this.storage.set(cacheKey, value, ttl);
  },
  
  del(type, key, userId) {
    const cacheKey = `${type}:${key}:${userId || 'global'}`;
    return this.storage.del(cacheKey);
  },
  
  flush() {
    return this.storage.flushAll();
  }
};

// Database models
const prisma = require("../../src/lib/prisma");
const {
  LoggingService,
  LOG_TYPES,
  MODULES,
  ACTIONS,
  STATUS,
} = require("../../services/logging-prisma.service");
const {
  INBOUND_LIST_SELECT,
  parseInboundListParams,
  buildInboundListWhere,
  wantsInboundPagination,
  summarizeInboundStatusGroups,
} = require("../../src/lib/inbound-list-helpers");

// Development logging helper - use this for debug logs in future development
const isDevelopment = process.env.NODE_ENV === 'development';
const debugLog = (...args) => {
  if (isDevelopment) {
    console.log(...args);
  }
};

// Helper function for delays
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Helper function to map invoice type names to codes
const getInvoiceTypeCode = (typeName) => {
  const typeMapping = {
    Invoice: "01",
    "Credit Note": "02",
    "Debit Note": "03",
    "Refund Note": "04",
    "Self-billed Invoice": "11",
    "Self-billed Credit Note": "12",
    "Self-billed Debit Note": "13",
    "Self-billed Refund Note": "14",
  };

  // If typeName already starts with a valid code (e.g. "01 - Invoice"), extract it
  const codeMatch = typeName?.match(/^(0[1-4]|1[1-4])/);
  if (codeMatch) {
    return codeMatch[1];
  }

  // Otherwise look up the code from the mapping
  return typeMapping[typeName] || "01"; // Default to '01' if not found
};

// Enhanced delay function with exponential backoff
const calculateBackoff = (retryCount, baseDelay = 1000, maxDelay = 60000) => {
  const backoff = Math.min(maxDelay, baseDelay * Math.pow(2, retryCount));
  const jitter = Math.random() * 1000; // Add some randomness to prevent thundering herd
  return backoff + jitter;
};

// Helper function to handle authentication errors
const handleAuthError = (req, res) => {
  // Clear session
  req.session.destroy((err) => {
    if (err) {
      console.error("Error destroying session:", err);
    }
  });

  // Return error response with redirect flag
  return res.status(401).json({
    success: false,
    message: "Authentication failed. Please log in again.",
    redirect: "/login",
  });
};

const rateLimit = require("express-rate-limit");
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  trustProxy: false, // Disable trust proxy
  keyGenerator: function (req) {
    // Use session ID or user ID if available, fallback to IP
    return req.session?.user?.id || req.ip;
  },
  handler: function (req, res) {
    return res.status(429).json({
      success: false,
      message: "Too many requests. Please try again later.",
      retryAfter: req.rateLimit.resetTime - Date.now(),
    });
  },
});

// Caching removed - fetching fresh data from API/database on each request

axiosRetry.default(axios, {
  retries: 3,
  retryDelay: axiosRetry.exponentialDelay,
  retryCondition: (error) => {
    return (
      axiosRetry.isNetworkOrIdempotentRequestError(error) ||
      error.response?.status === 429
    );
  },
});

// Search operation lock to prevent concurrent requests
const searchLock = {
  isLocked: false,
  lockedBy: null,
  lockedAt: null,
  
  acquire(requestId) {
    if (this.isLocked) {
      const lockDuration = Date.now() - this.lockedAt;
      // Auto-release if locked for more than 10 minutes (stuck lock)
      if (lockDuration > 600000) {
        console.warn(`[SearchLock] Auto-releasing stuck lock held by ${this.lockedBy} for ${lockDuration}ms`);
        this.release();
      } else {
        return false;
      }
    }
    this.isLocked = true;
    this.lockedBy = requestId;
    this.lockedAt = Date.now();
    console.log(`[SearchLock] Lock acquired by ${requestId}`);
    return true;
  },
  
  release() {
    if (this.isLocked) {
      const duration = Date.now() - this.lockedAt;
      console.log(`[SearchLock] Lock released by ${this.lockedBy} after ${duration}ms`);
    }
    this.isLocked = false;
    this.lockedBy = null;
    this.lockedAt = null;
  },
  
  getStatus() {
    if (!this.isLocked) {
      return { locked: false };
    }
    return {
      locked: true,
      lockedBy: this.lockedBy,
      duration: Date.now() - this.lockedAt
    };
  }
};

// Document retrieval limitations
const getDocumentRetrievalLimits = () => {
  return {
    maxDocuments: 10000, // Maximum number of documents that can be returned
    timeWindowDays: 30, // Time window in days for document retrieval
    validateTimeWindow: (dateTimeIssued) => {
      if (!dateTimeIssued) return false;
      const currentDate = new Date();
      const documentDate = new Date(dateTimeIssued);
      const diffTime = Math.abs(currentDate - documentDate);
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      return diffDays <= 30; // Only allow documents within last 30 days
    },
  };
};

// Helper function to get LHDN config
async function getLHDNConfig() {
  const config = await prisma.wP_CONFIGURATION.findFirst({
    where: {
      Type: "LHDN",
      IsActive: true,
    },
    orderBy: {
      CreateTS: "desc",
    },
  });

  if (!config || !config.Settings) {
    throw new Error("LHDN configuration not found");
  }

  let settings =
    typeof config.Settings === "string"
      ? JSON.parse(config.Settings)
      : config.Settings;

  const baseUrl =
    settings.environment === "production"
      ? settings.productionUrl || settings.middlewareUrl
      : settings.sandboxUrl || settings.middlewareUrl;

  if (!baseUrl) {
    throw new Error("LHDN API URL not configured");
  }

  // Enhanced timeout configuration with reasonable defaults
  const defaultTimeout = 60000; // 60 seconds default
  const minTimeout = 30000; // 30 seconds minimum
  const maxTimeout = 300000; // 5 minutes maximum

  let timeout = parseInt(settings.timeout) || defaultTimeout;
  timeout = Math.min(Math.max(timeout, minTimeout), maxTimeout);

  return {
    baseUrl,
    environment: settings.environment,
    timeout: timeout,
    retryEnabled: settings.retryEnabled !== false, // Enable retries by default
    maxRetries: settings.maxRetries || 5,
    retryDelay: settings.retryDelay || 1000, // Base delay for exponential backoff
    maxRetryDelay: settings.maxRetryDelay || 60000, // Maximum retry delay
  };
}

// Helper function to get portal URL based on environment
function getPortalUrl(environment) {
  const portalUrls = {
    production: "myinvois.hasil.gov.my",
    sandbox: "preprod.myinvois.hasil.gov.my",
  };

  return portalUrls[environment] || portalUrls.sandbox; // Default to sandbox if environment not specified
}

// Enhanced document fetching function with smart caching and incremental sync
const fetchRecentDocumentsImpl = async (req) => {
  // console.log("Starting enhanced document fetch process...");

  try {
    // Get LHDN configuration
    const lhdnConfig = await getLHDNConfig();
    // console.log("Using LHDN configuration:", {
    //   environment: lhdnConfig.environment,
    //   baseUrl: lhdnConfig.baseUrl,
    //   timeout: lhdnConfig.timeout,
    // });

    // Check sync strategy from query parameters
    const incrementalSync = req.query.incrementalSync !== "false"; // Default to true
    const forceRefresh = req.query.forceRefresh === "true";
    const maxIncrementalPages = parseInt(req.query.maxIncrementalPages) || 5; // Limit incremental sync pages

    // First, check if we have data in the database
    const dbDocuments = await prisma.wP_INBOUND_STATUS.findMany({
      orderBy: {
        dateTimeReceived: "desc",
      },
    });

    // Get the most recent document timestamp for incremental sync
    let lastSyncTimestamp = null;
    if (incrementalSync && dbDocuments.length > 0) {
      const mostRecentDoc = await prisma.wP_INBOUND_STATUS.findFirst({
        orderBy: {
          dateTimeValidated: "desc",
        },
        select: {
          dateTimeValidated: true,
          dateTimeReceived: true,
        },
      });

      if (mostRecentDoc) {
        // Use the most recent validation or received timestamp
        lastSyncTimestamp =
          mostRecentDoc.dateTimeValidated || mostRecentDoc.dateTimeReceived;
        // console.log(
        //   `Incremental sync enabled. Last document timestamp: ${lastSyncTimestamp}`
        // );
      }
    }

    // If we have database records, use them as the initial data source
    if (dbDocuments && dbDocuments.length > 0) {
      // console.log(`Found ${dbDocuments.length} documents in database`);

      // Check if we need to refresh from API
      const lastSyncedDocument = await prisma.wP_INBOUND_STATUS.findFirst({
        orderBy: {
          last_sync_date: "desc",
        },
        select: {
          last_sync_date: true,
        },
      });

      const currentTime = new Date();
      const hasNonTerminalRows = dbDocuments.some((d) =>
        isNonTerminalInboundStatus(d.status)
      );
      const syncThreshold = hasNonTerminalRows
        ? INBOUND_NON_TERMINAL_SYNC_MS
        : INBOUND_DEFAULT_SYNC_MS;

      // Only fetch from API if forced or if last sync is older than threshold
      if (
        !forceRefresh &&
        lastSyncedDocument &&
        lastSyncedDocument.last_sync_date
      ) {
        const timeSinceLastSync =
          currentTime - new Date(lastSyncedDocument.last_sync_date);
        if (timeSinceLastSync < syncThreshold) {
          // console.log(
          //   "Using database records - last sync was",
          //   Math.round(timeSinceLastSync / 1000 / 60),
          //   "minutes ago"
          // );
          return {
            result: dbDocuments,
            cached: true,
            fromDatabase: true,
          };
        }
      }

      // If we're here, we need to refresh from API but still have DB records as fallback
      if (incrementalSync && lastSyncTimestamp) {
        // console.log(
        //   "Database records exist, performing incremental sync from API"
        // );
      } else {
        // console.log("Database records exist but need full refresh from API");
      }
    } else {
      // console.log("No documents found in database, will fetch from API");
    }

    // Attempt to fetch from API
    try {
      req._lhdnAuthRefreshCount = 0;
      // console.log("Fetching fresh data from LHDN API...");
      const documents = [];
      let pageNo = 1;
      const pageSize = 100; // MyInvois recommended page size
      let hasMorePages = true;
      let consecutiveErrors = 0;
      const maxConsecutiveErrors = 3;

      // Track rate limiting
      let rateLimitRemaining = null;
      let rateLimitReset = null;

      while (hasMorePages) {
        let retryCount = 0;
        let success = false;

        while (!success && retryCount < lhdnConfig.maxRetries) {
          try {
            // Check rate limit before making request
            if (rateLimitRemaining !== null && rateLimitRemaining <= 0) {
              const waitTime =
                new Date(rateLimitReset).getTime() - Date.now() + 1000; // Add 1s buffer
              if (waitTime > 0) {
                // Rate limit logging - keep for monitoring
                console.log(
                  `Rate limit reached. Waiting ${Math.round(
                    waitTime / 1000
                  )}s before continuing...`
                );
                await delay(waitTime);
              }
            }

            const {
              getTokenSession,
            } = require("../../services/token-prisma.service");

            let token = req.session?.accessToken;
            if (!token) {
              token = await getTokenSession();
              if (req.session) {
                req.session.accessToken = token;
              }
            }

            if (!token) {
              console.error("No valid LHDN access token available");
              throw new Error("No valid access token found");
            }

            // console.log("Using token for LHDN API request");

            const response = await axios.get(
              `${lhdnConfig.baseUrl}/api/v1.0/documents/recent`,
              {
                params: {
                  pageNo: pageNo,
                  pageSize: pageSize,
                  sortBy: "dateTimeValidated",
                  sortOrder: "desc",
                },
                headers: {
                  Authorization: `Bearer ${token}`,
                  Accept: "application/json",
                  "Content-Type": "application/json",
                },
                timeout: lhdnConfig.timeout,
              }
            );

            // Update rate limit tracking from headers
            rateLimitRemaining = parseInt(
              response.headers["x-rate-limit-remaining"] || "-1"
            );
            rateLimitReset = response.headers["x-rate-limit-reset"];

            // Handle pagination
            const { result, pagination } = response.data;

            if (!result || result.length === 0) {
              // console.log(`No more documents found after page ${pageNo - 1}`);
              hasMorePages = false;
              break;
            }

            // Map the required fields from the API response - IMPORTANT: follow MyInvois API structure
            const mappedDocuments = result.map((doc) => ({
              ...doc,
              // Map issuerTin or supplierTin to issuerTin
              issuerTin: doc.issuerTin || doc.supplierTin || null,

              // Map issuerName or supplierName to issuerName
              issuerName: doc.issuerName || doc.supplierName || null,

              // Map receiverId or buyerTin to receiverId
              receiverId:
                doc.receiverId || doc.buyerTin || doc.buyerTIN || null,

              // Map receiverName or buyerName to receiverName
              receiverName: doc.receiverName || doc.buyerName || null,

              // Map receiverTIN or buyerTIN to receiverTIN
              receiverTIN: doc.receiverTIN || doc.buyerTIN || null,

              receiverRegistrationNo:
                doc.receiverRegistrationNo || doc.buyerRegistrationNo || null,
              receiverAddress: doc.receiverAddress || doc.buyerAddress || null,
              receiverPostcode:
                doc.receiverPostcode || doc.buyerPostcode || null,
              receiverCity: doc.receiverCity || doc.buyerCity || null,
              receiverState: doc.receiverState || doc.buyerState || null,
              receiverCountry: doc.receiverCountry || doc.buyerCountry || null,
              receiverPhone: doc.receiverPhone || doc.buyerPhone || null,

              uuid: doc.uuid,
              submissionUid: doc.submissionUid,
              longId: doc.longId,
              internalId: doc.internalId,
              typeName: doc.typeName,
              typeVersionName: doc.typeVersionName,
              dateTimeReceived: doc.dateTimeReceived,
              dateTimeIssued: doc.dateTimeIssued,
              dateTimeValidated: doc.dateTimeValidated,
              status: doc.status,
              documentStatusReason: doc.documentStatusReason,
              totalSales: doc.totalSales || doc.total || doc.netAmount || 0,
              totalExcludingTax: doc.totalExcludingTax || 0,
              totalDiscount: doc.totalDiscount || 0,
              totalNetAmount: doc.totalNetAmount || doc.netAmount || 0,
              totalPayableAmount: doc.totalPayableAmount || doc.total || 0,
            }));

            // console.log(
            //   `Mapped ${mappedDocuments.length} documents from API response`
            // );

            // Always upsert every document on this page. Incremental sync must NOT filter
            // what we save: same UUID can change Invalid → Valid with the same or older
            // dateTimeValidated vs DB "last sync" time; filtering by timestamp skipped those upserts
            // and left stale status in WP_INBOUND_STATUS.
            documents.push(...mappedDocuments);

            // Incremental heuristics: only decide when to stop requesting further pages
            let newDocumentsFound = 0;
            let existingDocumentsFound = 0;

            if (incrementalSync && lastSyncTimestamp) {
              for (const doc of mappedDocuments) {
                const docTimestamp =
                  doc.dateTimeValidated || doc.dateTimeReceived;

                if (
                  docTimestamp &&
                  new Date(docTimestamp) > new Date(lastSyncTimestamp)
                ) {
                  newDocumentsFound++;
                } else {
                  existingDocumentsFound++;
                  if (existingDocumentsFound >= 10) {
                    hasMorePages = false;
                    break;
                  }
                }
              }

              if (
                existingDocumentsFound > newDocumentsFound &&
                existingDocumentsFound >= 5
              ) {
                hasMorePages = false;
              }
            }

            // Limit incremental sync to maxIncrementalPages to prevent excessive API calls
            if (incrementalSync && pageNo >= maxIncrementalPages) {
              // console.log(
              //   `Reached maximum incremental pages (${maxIncrementalPages}), stopping sync`
              // );
              hasMorePages = false;
            }

            // Check if we have more pages based on pagination info (only if not stopped by incremental logic)
            if (hasMorePages) {
              if (pagination) {
                hasMorePages = pageNo < pagination.totalPages;
              } else {
                hasMorePages = result.length === pageSize;
              }
            }

            // Reset consecutive errors counter on success
            consecutiveErrors = 0;
            success = true;
            pageNo++;

            // Adaptive delay between requests based on rate limit headers
            if (hasMorePages) {
              let adaptiveDelay = 500; // Base delay

              // Adjust delay based on remaining rate limit
              if (rateLimitRemaining !== null && rateLimitRemaining >= 0) {
                if (rateLimitRemaining < 10) {
                  adaptiveDelay = 2000; // Slow down when approaching limit
                } else if (rateLimitRemaining < 50) {
                  adaptiveDelay = 1000; // Moderate slowdown
                }
              }

              // Add jitter to prevent thundering herd
              const jitter = Math.random() * 200; // 0-200ms jitter
              adaptiveDelay += jitter;

              // console.log(
              //   `Adaptive delay: ${Math.round(
              //     adaptiveDelay
              //   )}ms (remaining: ${rateLimitRemaining})`
              // );
              await delay(adaptiveDelay);
            }
          } catch (error) {
            retryCount++;
            console.error(`Error fetching page ${pageNo}:`, error.message);

            // Handle authentication errors — invalidate stale cache, force one new token
            if (
              error.response?.status === 401 ||
              error.response?.status === 403
            ) {
              console.error("Authentication error detected:", error.message);

              if ((req._lhdnAuthRefreshCount || 0) >= 1) {
                throw new Error(
                  "LHDN authentication failed after token refresh. Verify client ID, secret, and API URL in LHDN settings."
                );
              }

              try {
                await refreshLhdnTokenAfter401(req);
                req._lhdnAuthRefreshCount = (req._lhdnAuthRefreshCount || 0) + 1;
                retryCount++;
                continue;
              } catch (refreshError) {
                console.error("Token refresh failed:", refreshError.message);
                throw new Error(
                  "Authentication failed. Check LHDN configuration and try again."
                );
              }
            }

            // Enhanced rate limiting handling
            if (error.response?.status === 429) {
              const retryAfter = error.response.headers["retry-after"];
              const resetTime = error.response.headers["x-rate-limit-reset"];
              const remaining =
                error.response.headers["x-rate-limit-remaining"];

              rateLimitRemaining = parseInt(remaining) || 0;
              rateLimitReset = resetTime;

              // Calculate wait time with multiple strategies
              let waitTime = 0;

              if (retryAfter) {
                // Use Retry-After header if available (in seconds)
                waitTime = parseInt(retryAfter) * 1000;
              } else if (resetTime) {
                // Use rate limit reset time
                waitTime = new Date(resetTime).getTime() - Date.now();
              } else {
                // Fallback: exponential backoff with jitter
                const baseDelay = 2000; // 2 seconds base
                const exponentialDelay = baseDelay * Math.pow(2, retryCount);
                const jitter = Math.random() * 1000; // Add up to 1 second jitter
                waitTime = Math.min(exponentialDelay + jitter, 60000); // Max 60 seconds
              }

              // Ensure minimum wait time and add buffer
              waitTime = Math.max(waitTime, 1000) + 500; // Minimum 1.5 seconds

              console.log(
                `Rate limited (429). Waiting ${Math.round(
                  waitTime / 1000
                )}s before retry (attempt ${retryCount}/${
                  lhdnConfig.maxRetries
                })...`
              );

              await delay(waitTime);
              retryCount--; // Don't count rate limit retries against max retries
              continue;
            }

            // Track consecutive errors
            if (retryCount >= lhdnConfig.maxRetries) {
              consecutiveErrors++;
              if (consecutiveErrors >= maxConsecutiveErrors) {
                console.error(
                  `Max consecutive errors (${maxConsecutiveErrors}) reached. Stopping fetch.`
                );
                hasMorePages = false;
                break;
              }
              // console.log(
              //   `Moving to next page after max retries for page ${pageNo}`
              // );
              pageNo++;
              break;
            }

            // Exponential backoff for other errors
            const backoffDelay = Math.min(
              lhdnConfig.maxRetryDelay,
              lhdnConfig.retryDelay * Math.pow(2, retryCount)
            );
            // console.log(
            //   `Retrying page ${pageNo} after ${
            //     backoffDelay / 1000
            //   }s delay (attempt ${retryCount + 1}/${lhdnConfig.maxRetries})...`
            // );
            await delay(backoffDelay);
          }
        }

        if (!success && consecutiveErrors >= maxConsecutiveErrors) {
          hasMorePages = false;
        }
      }

      if (documents.length === 0) {
        throw new Error("No documents could be fetched from the API");
      }

      // console.log(
      //   `Fetch complete. Total documents retrieved: ${documents.length}`
      // );

      // Save the fetched documents to database
      await saveInboundStatus({ result: documents }, req);

      // List API omits validation steps; details API is authoritative for status/reasons.
      await enrichInboundDocumentsFromLhdnDetails(documents, req).catch((err) =>
        console.warn("[Inbound enrich] Skipped:", err.message)
      );

      // If we have submission UIDs, poll their status
      const uniquesubmissionuids = extractUniqueSubmissionUids(documents);
       if (uniquesubmissionuids.length > 0) {
         // console.log(
         //   `found ${uniquesubmissionuids.length} unique submission uids to poll`
         // );

         // poll each submission in sequence to avoid rate limiting
         for (const submissionuid of uniquesubmissionuids) {
           try {
             // console.log(`polling submission status for: ${submissionuid}`);
             await pollSubmissionStatus(submissionuid, 5); // limit to 5 attempts for background polling
           } catch (pollerror) {
             console.error(
              `error polling submission ${submissionuid}:`,
              pollerror
             );
             // continue with next submission even if this one fails
           }

           // add a small delay between submissions to avoid rate limiting
           await delay(1000);
         }
       }

      // Log successful document fetch
      await LoggingService.log({
        description: `Successfully fetched ${documents.length} documents from LHDN`,
        username: req?.session?.user?.username || "System",
        userId: req?.session?.user?.id,
        ipAddress: req?.ip,
        logType: LOG_TYPES.INFO,
        module: MODULES.API,
        action: ACTIONS.READ,
        status: STATUS.SUCCESS,
        details: { count: documents.length },
      });

      const totalInDb = await prisma.wP_INBOUND_STATUS.count();
      console.log(
        `[fetchRecentDocuments] API synced ${documents.length} docs, ${totalInDb} total in DB (list via paged query)`
      );

      return {
        result: [],
        apiSyncedCount: documents.length,
        recordsTotal: totalInDb,
        cached: false,
        fromApi: true,
        fromDatabase: true,
      };
    } catch (error) {
      console.error("Error fetching from LHDN API:", error.message);

      // Log the error
      await LoggingService.log({
        description: `Error fetching documents from LHDN: ${error.message}`,
        username: req?.session?.user?.username || "System",
        userId: req?.session?.user?.id,
        ipAddress: req?.ip,
        logType: LOG_TYPES.ERROR,
        module: MODULES.API,
        action: ACTIONS.READ,
        status: STATUS.FAILED,
        details: { error: error.message },
      });

      // If we have database records, use them as fallback
      if (dbDocuments && dbDocuments.length > 0) {
        // console.log(`Using ${dbDocuments.length} database records as fallback`);
        return {
          result: dbDocuments,
          cached: true,
          fromDatabase: true,
          fallback: true,
          error: error.message,
        };
      }

      // If no database records, rethrow the error
      throw error;
    }
  } catch (error) {
    console.error("Error in document fetch:", error);
    return {
      success: false,
      message: `Error fetching documents: ${error.message}`,
      error: error,
    };
  }
};

const {
  getInboundSyncSessionKey: inboundSyncSessionKey,
  isStaleInboundSyncRequest: isStaleSyncId,
  coalesceInboundForceRefresh,
} = require("../../src/lib/inbound-sync-request-helpers");

/** Per-user active forceRefresh sync token — stale clients (e.g. after F5) are ignored. */
const activeSyncRequestId = new Map();
/** One in-flight LHDN forceRefresh per session; overlapping callers await the same promise. */
const inboundForceRefreshInFlight = new Map();

function getInboundSyncSessionKey(req) {
  return inboundSyncSessionKey(req.session);
}

function registerInboundSyncRequest(req) {
  const syncRequestId = req.query.syncRequestId;
  if (!syncRequestId) return;
  activeSyncRequestId.set(getInboundSyncSessionKey(req), syncRequestId);
}

function isStaleInboundSyncRequest(req) {
  const syncRequestId = req.query.syncRequestId;
  if (!syncRequestId) return false;
  const current = activeSyncRequestId.get(getInboundSyncSessionKey(req));
  return isStaleSyncId(current, syncRequestId);
}

async function buildStaleForceRefreshPageData(req) {
  if (!wantsInboundPagination(req)) {
    return {
      result: [],
      staleSync: true,
      supersededSync: true,
      cached: false,
      fromDatabase: true,
      fromApi: true,
      timestamp: new Date().toISOString(),
    };
  }
  const page = await queryInboundListPage(req);
  return {
    result: page.rows,
    paginated: true,
    recordsTotal: page.recordsTotal,
    recordsFiltered: page.recordsFiltered,
    start: page.start,
    length: page.length,
    cached: false,
    fromDatabase: true,
    fromApi: true,
    supersededSync: true,
    timestamp: new Date().toISOString(),
  };
}

async function queryInboundListPage(req) {
  const params = parseInboundListParams(req);
  const where = buildInboundListWhere(params);

  const [recordsTotal, recordsFiltered, rows] = await Promise.all([
    prisma.wP_INBOUND_STATUS.count(),
    prisma.wP_INBOUND_STATUS.count({ where }),
    prisma.wP_INBOUND_STATUS.findMany({
      where,
      select: INBOUND_LIST_SELECT,
      orderBy: params.orderBy,
      skip: params.start,
      take: params.length,
    }),
  ]);

  return {
    rows,
    recordsTotal,
    recordsFiltered,
    start: params.start,
    length: params.length,
  };
}

function buildInboundPaginatedJson(page, formattedDocuments, extraMetadata = {}) {
  return {
    success: true,
    result: formattedDocuments,
    recordsTotal: page.recordsTotal,
    recordsFiltered: page.recordsFiltered,
    metadata: {
      recordsTotal: page.recordsTotal,
      recordsFiltered: page.recordsFiltered,
      start: page.start,
      length: page.length,
      ...extraMetadata,
    },
  };
}

/**
 * Run at most one inbound LHDN /documents/recent sync at a time. Overlapping calls (e.g. force
 * refresh + background sync from getCachedDocuments) used to interleave saveInboundStatus and
 * could apply API page batches out of order, flipping the same UUID Valid ↔ Invalid.
 */
let inboundRecentSyncChain = Promise.resolve();

const fetchRecentDocuments = async (req) => {
  const syncRequestId = req.query.syncRequestId || null;
  if (syncRequestId) {
    registerInboundSyncRequest(req);
  }
  const ownerId = syncRequestId;
  const run = async () => {
    const result = await fetchRecentDocumentsImpl(req);
    const sessionKey = getInboundSyncSessionKey(req);
    const activeId = activeSyncRequestId.get(sessionKey);
    if (ownerId && isStaleSyncId(activeId, ownerId)) {
      return { ...result, staleSync: true };
    }
    return result;
  };
  const p = inboundRecentSyncChain.then(run);
  inboundRecentSyncChain = p.catch(() => {});
  return p;
};

// Function to get documents - no caching, direct fetch
async function getCachedDocuments(req) {
  const useDatabase = req.query.useDatabase === "true";
  const incremental = req.query.incremental === "true";
  const forceRefresh = req.query.forceRefresh === "true";
  let data;

  try {
    // Explicit refresh: wait for LHDN /documents/recent sync first, then return fresh rows.
    // Without this, we only returned WP_INBOUND_STATUS immediately and fetched LHDN in the background
    // (user never saw new invoices until a later request).
    if (forceRefresh) {
      registerInboundSyncRequest(req);
      const sessionKey = getInboundSyncSessionKey(req);
      try {
        console.log(
          "[getCachedDocuments] forceRefresh=true — awaiting fetchRecentDocuments"
        );
        await coalesceInboundForceRefresh(
          inboundForceRefreshInFlight,
          sessionKey,
          () => fetchRecentDocuments(req)
        );
      } catch (frErr) {
        console.error(
          "[getCachedDocuments] forceRefresh fetchRecentDocuments failed:",
          frErr.message
        );
      }

      if (isStaleInboundSyncRequest(req)) {
        console.log(
          "[getCachedDocuments] Superseded forceRefresh — returning DB page",
          req.query.syncRequestId
        );
        return buildStaleForceRefreshPageData(req);
      }

      try {
        if (wantsInboundPagination(req)) {
          const page = await queryInboundListPage(req);
          console.log(
            `[getCachedDocuments] forceRefresh done — returning page ${page.start}-${page.start + page.rows.length} of ${page.recordsFiltered} filtered (${page.recordsTotal} total)`
          );
          return {
            result: page.rows,
            paginated: true,
            recordsTotal: page.recordsTotal,
            recordsFiltered: page.recordsFiltered,
            start: page.start,
            length: page.length,
            cached: false,
            fromDatabase: true,
            fromApi: true,
            timestamp: new Date().toISOString(),
          };
        }

        const allDocuments = await prisma.wP_INBOUND_STATUS.findMany({
          select: INBOUND_LIST_SELECT,
          orderBy: { dateTimeReceived: "desc" },
        });
        if (allDocuments && allDocuments.length > 0) {
          console.log(
            `[getCachedDocuments] forceRefresh done — returning ${allDocuments.length} records from DB`
          );
          return {
            result: allDocuments,
            cached: false,
            fromDatabase: true,
            fromApi: true,
            timestamp: new Date().toISOString(),
          };
        }
      } catch (dbErr) {
        console.error(
          "[getCachedDocuments] DB read after forceRefresh failed:",
          dbErr.message
        );
      }
      // Fall through to DB-first path if both API and post-sync DB read failed
    }

    // If useDatabase is true OR incremental is true, try to get from database first
    if (useDatabase || incremental) {
      try {
        console.log(
          `📊 Using database as primary data source - useDatabase: ${useDatabase}, incremental: ${incremental}`
        );
        if (wantsInboundPagination(req)) {
          const page = await queryInboundListPage(req);
          console.log(
            `✅ Found ${page.recordsTotal} documents in WP_INBOUND_STATUS (page ${page.rows.length} rows)`
          );
          data = {
            result: page.rows,
            paginated: true,
            recordsTotal: page.recordsTotal,
            recordsFiltered: page.recordsFiltered,
            start: page.start,
            length: page.length,
            cached: false,
            fromDatabase: true,
            fromApi: false,
            timestamp: new Date().toISOString(),
          };
        } else {
          const dbDocuments = await prisma.wP_INBOUND_STATUS.findMany({
            select: INBOUND_LIST_SELECT,
            orderBy: {
              dateTimeReceived: "desc",
            },
          });

          if (dbDocuments && dbDocuments.length > 0) {
            console.log(`✅ Found ${dbDocuments.length} documents in WP_INBOUND_STATUS database`);
            data = {
              result: dbDocuments,
              cached: false,
              fromDatabase: true,
              fromApi: false,
              timestamp: new Date().toISOString(),
            };
          }
        }

        if (data) {

          const skipBackground = await shouldSkipInboundBackgroundSync(req);
          if (!skipBackground) {
            try {
              fetchRecentDocuments(req).catch((apiError) => {
                console.warn("Background API fetch failed:", apiError.message);
              });
            } catch (backgroundError) {
              console.warn("Error starting background fetch:", backgroundError);
            }
          } else {
            console.log(
              "[getCachedDocuments] Skipping background LHDN sync (gated)"
            );
          }

          return data;
        }

        if (useDatabase) {
          // Honor strict database mode: do not call API, return empty dataset
          console.log("ℹ️ No documents in WP_INBOUND_STATUS; honoring useDatabase=true with empty result");
          data = {
            result: [],
            cached: false,
            fromDatabase: true,
            fromApi: false,
            timestamp: new Date().toISOString(),
          };
          return data;
        }
      } catch (dbError) {
        console.error("Error getting documents from database:", dbError);
        // Continue to API fetch if database fetch fails
      }
    }

    // If not using database or database fetch failed, fetch from API
    data = await fetchRecentDocuments(req);
  } catch (error) {
    console.error("Error in getCachedDocuments:", error);

    // Check if it's an authentication error
    if (error.message?.includes("Authentication failed")) {
      // Log authentication error
      await LoggingService.log({
        description: `Authentication error in getCachedDocuments: ${error.message}`,
        username: req.session?.user?.username || "System",
        userId: req.session?.user?.id,
        ipAddress: req.ip,
        logType: LOG_TYPES.ERROR,
        module: MODULES.AUTH,
        action: ACTIONS.READ,
        status: STATUS.FAILED,
        details: { error: error.message },
      });

      try {
        req._lhdnAuthRefreshCount = 0;
        await refreshLhdnTokenAfter401(req);
        data = await fetchRecentDocuments(req);
      } catch (tokenError) {
        console.error("Error refreshing LHDN token after auth failure:", tokenError);
      }
    }

    // If we still don't have data, try database fallback
    if (!data || !data.result || data.result.length === 0) {
      try {
        if (wantsInboundPagination(req)) {
          const page = await queryInboundListPage(req);
          data = {
            result: page.rows,
            paginated: true,
            recordsTotal: page.recordsTotal,
            recordsFiltered: page.recordsFiltered,
            start: page.start,
            length: page.length,
            cached: false,
            fromDatabase: true,
            fallback: true,
            error: error.message,
          };
        } else {
          const fallbackDocuments = await prisma.wP_INBOUND_STATUS.findMany({
            select: INBOUND_LIST_SELECT,
            orderBy: {
              dateTimeReceived: "desc",
            },
            take: 9999,
          });

          if (fallbackDocuments && fallbackDocuments.length > 0) {
            data = {
              result: fallbackDocuments,
              cached: false,
              fromDatabase: true,
              fallback: true,
              error: error.message,
            };
          }
        }

        if (!data || (!data.paginated && (!data.result || data.result.length === 0))) {
          throw new Error("No documents found in database");
        }
      } catch (dbError) {
        console.error("Database fallback also failed:", dbError);
        throw error; // Rethrow the original error
      }
    }
  }

  if (
    data &&
    wantsInboundPagination(req) &&
    !data.paginated &&
    (!data.result || data.result.length === 0)
  ) {
    const page = await queryInboundListPage(req);
    data = {
      ...data,
      result: page.rows,
      paginated: true,
      recordsTotal: page.recordsTotal,
      recordsFiltered: page.recordsFiltered,
      start: page.start,
      length: page.length,
      fromDatabase: true,
    };
  }

  return data;
}

const generateTemplateHash = (templateData) => {
  const crypto = require("crypto");
  // Create a string of key data that should trigger regeneration when changed
  const keyData = JSON.stringify({
    logo: templateData.CompanyLogo,
    companyInfo: {
      name: templateData.companyName,
      address: templateData.companyAddress,
      phone: templateData.companyPhone,
      email: templateData.companyEmail,
    },
    documentInfo: {
      type: templateData.InvoiceType,
      code: templateData.InvoiceCode,
      uuid: templateData.UniqueIdentifier,
    },
    items: templateData.items,
    totals: {
      subtotal: templateData.Subtotal,
      tax: templateData.TotalTaxAmount,
      total: templateData.TotalPayableAmount,
    },
  });
  return crypto.createHash("md5").update(keyData).digest("hex");
};

// --- Concurrency-safe DB helpers (retries for deadlocks/write conflicts) ---
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function isRetryableDbError(err) {
  const msg = (err && err.message ? err.message : "").toLowerCase();
  return (
    err?.code === "P2034" ||
    msg.includes("deadlock") ||
    msg.includes("write conflict")
  );
}
async function withDbRetry(fn, { retries = 5, baseDelay = 200 } = {}) {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (err) {
      if (isRetryableDbError(err) && attempt < retries) {
        attempt++;
        const jitter = Math.floor(Math.random() * 100);
        const delay = baseDelay * Math.pow(2, attempt - 1) + jitter;
        console.warn(
          `[DB-RETRY] attempt ${attempt}/${retries} after ${delay}ms due to:`,
          err.code || err.message
        );
        await wait(delay);
        continue;
      }
      throw err;
    }
  }
}

const formatInboundDateField = (date) => {
  if (!date) return null;
  if (typeof date === "string") return date;
  if (date instanceof Date) return date.toISOString();
  return null;
};

/** Max detail calls per recent sync (LHDN rate limits; details is heavier than list). */
const MAX_INBOUND_DETAILS_ENRICH = 35;
const INBOUND_NON_TERMINAL_SYNC_MS = 5 * 60 * 1000;
const INBOUND_DEFAULT_SYNC_MS = 15 * 60 * 1000;
const INBOUND_LHDN_401_COOLDOWN_MS = 10 * 60 * 1000;
let inboundLhdn401CooldownUntil = 0;

function markInboundLhdn401Cooldown() {
  inboundLhdn401CooldownUntil = Date.now() + INBOUND_LHDN_401_COOLDOWN_MS;
}

/** Gate background fetchRecentDocuments (sync threshold, 401 cooldown, client flags). */
async function shouldSkipInboundBackgroundSync(req) {
  if (req.query.fallbackOnly === "true") {
    return true;
  }
  if (req.query.skipBackgroundSync === "true") {
    return true;
  }
  if (Date.now() < inboundLhdn401CooldownUntil) {
    return true;
  }
  if (req.query.forceRefresh === "true") {
    return false;
  }

  try {
    const lastSyncedDocument = await prisma.wP_INBOUND_STATUS.findFirst({
      orderBy: { last_sync_date: "desc" },
      select: { last_sync_date: true },
    });
    if (!lastSyncedDocument?.last_sync_date) {
      return false;
    }

    const dbStatuses = await prisma.wP_INBOUND_STATUS.findMany({
      select: { status: true },
      take: 5000,
    });
    const hasNonTerminalRows = dbStatuses.some((d) =>
      isNonTerminalInboundStatus(d.status)
    );
    const syncThreshold = hasNonTerminalRows
      ? INBOUND_NON_TERMINAL_SYNC_MS
      : INBOUND_DEFAULT_SYNC_MS;
    const timeSinceLastSync =
      Date.now() - new Date(lastSyncedDocument.last_sync_date).getTime();
    return timeSinceLastSync < syncThreshold;
  } catch (gateErr) {
    console.warn(
      "[getCachedDocuments] Background sync gate check failed:",
      gateErr.message
    );
    return false;
  }
}

const {
  getSubmissionUidFromDoc,
  extractUniqueSubmissionUids,
  isNonTerminalInboundStatus,
} = require("../../src/lib/inbound-sync-helpers");

/**
 * List `/documents/recent` does not include validation steps or full reasons.
 * For Invalid rows (and list/ details status mismatch), call GET .../documents/{uuid}/details
 * to persist validationResults + documentStatusReason and reconcile status with the authoritative details API.
 */
async function enrichInboundDocumentsFromLhdnDetails(documents, req) {
  if (!documents?.length) return;

  let token = req.session?.accessToken;
  if (!token) {
    try {
      token = await readTokenFromFile();
    } catch (_) {
      /* ignore */
    }
  }
  if (!token) {
    console.warn("[Inbound enrich] No access token; skipping details enrichment");
    return;
  }

  const lhdnConfig = await getLHDNConfig();
  const enrichableStatuses = new Set([
    "invalid",
    "cancelled",
    "rejected",
    "submitted",
    "processing",
    "pending",
  ]);
  const toEnrich = documents
    .filter((d) => enrichableStatuses.has((d.status || "").toLowerCase()))
    .sort((a, b) => {
      const prio = (st) => (isNonTerminalInboundStatus(st) ? 0 : 1);
      return prio(a.status) - prio(b.status);
    })
    .slice(0, MAX_INBOUND_DETAILS_ENRICH);

  if (toEnrich.length === 0) return;

  console.log(
    `[Inbound enrich] Fetching LHDN details for ${toEnrich.length} document(s) (validation + status reconcile)`
  );

  for (const doc of toEnrich) {
    const uuid = doc.uuid;
    if (!uuid) continue;

    try {
      const { data: details } = await axios.get(
        `${lhdnConfig.baseUrl}/api/v1.0/documents/${uuid}/details`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          timeout: lhdnConfig.timeout || 30000,
        }
      );

      const data = {
        updated_at: new Date().toISOString(),
      };

      if (details.validationResults) {
        data.validationResults = JSON.stringify({
          status: details.status,
          validationResults: details.validationResults,
          enrichedAt: new Date().toISOString(),
        });
      }
      if (details.documentStatusReason !== undefined) {
        data.documentStatusReason = details.documentStatusReason || null;
      }
      if (details.status) {
        data.status = details.status;
      }
      if (details.dateTimeValidated) {
        data.dateTimeValidated = formatInboundDateField(details.dateTimeValidated);
      }

      await prisma.wP_INBOUND_STATUS.update({
        where: { uuid },
        data,
      });

      const idx = documents.findIndex((d) => d.uuid === uuid);
      if (idx !== -1) {
        documents[idx] = {
          ...documents[idx],
          status: data.status ?? documents[idx].status,
          documentStatusReason:
            data.documentStatusReason !== undefined
              ? data.documentStatusReason
              : documents[idx].documentStatusReason,
          dateTimeValidated:
            data.dateTimeValidated ?? documents[idx].dateTimeValidated,
        };
      }

      if (details.status && doc.status && details.status !== doc.status) {
        console.log(
          `[Inbound enrich] Status reconciled for ${uuid}: list had "${doc.status}" → details API "${details.status}"`
        );
      }
    } catch (e) {
      console.warn(
        `[Inbound enrich] GET details failed for ${uuid}:`,
        e.response?.status || e.message
      );
    }

    await wait(450);
  }
}

// Enhanced transaction wrapper for database operations
async function withTransaction(fn, { retries = 3, baseDelay = 300 } = {}) {
  let attempt = 0;
  while (true) {
    try {
      return await prisma.$transaction(async (tx) => {
        return await fn(tx);
      }, {
        maxWait: 10000, // 10 seconds
        timeout: 30000, // 30 seconds
        isolationLevel: 'ReadCommitted' // Use READ COMMITTED to reduce deadlocks
      });
    } catch (err) {
      if (isRetryableDbError(err) && attempt < retries) {
        attempt++;
        const jitter = Math.floor(Math.random() * 200);
        const delay = baseDelay * Math.pow(2, attempt - 1) + jitter;
        console.warn(
          `[TX-RETRY] attempt ${attempt}/${retries} after ${delay}ms due to:`,
          err.code || err.message
        );
        await wait(delay);
        continue;
      }
      throw err;
    }
  }
}

// Enhanced save to database function
const saveInboundStatus = async (data, req = null) => {
  if (!data.result || !Array.isArray(data.result)) {
    console.warn("No valid data to process");
    await LoggingService.log({
      description: "No valid data to process for inbound status",
      logType: LOG_TYPES.WARNING,
      module: MODULES.API,
      action: ACTIONS.CREATE,
      status: STATUS.WARNING,
    });
    return;
  }

  const batchSize = 100;
  const batches = [];
  // const maxRetries = 3; // Not used but kept for reference
  // const retryDelay = 1000; // Not used but kept for reference
  let successCount = 0;
  let errorCount = 0;
  let responseFileResults = [];

  for (let i = 0; i < data.result.length; i += batchSize) {
    batches.push(data.result.slice(i, i + batchSize));
  }

  // console.log(
  //   `Processing ${batches.length} batches of ${batchSize} documents each`
  // );

  // Log the start of batch processing
  await LoggingService.log({
    description: `Starting to process ${data.result.length} documents in ${batches.length} batches`,
    logType: LOG_TYPES.INFO,
    module: MODULES.API,
    action: ACTIONS.CREATE,
    status: STATUS.PENDING,
    details: { totalDocuments: data.result.length, batchCount: batches.length },
  });

  // Helper function to format dates
  const formatDate = (date) => {
    if (!date) return null;
    if (typeof date === "string") return date;
    if (date instanceof Date) return date.toISOString();
    return null;
  };

  // Process batches sequentially to reduce concurrency
  for (const batch of batches) {
    // One upsert at a time: parallel chunks (previously 5) exhausted the Prisma pool
    // (default connection_limit=5) when combined with sessions and other routes → P2024.
    const chunkSize = 1;
    for (let i = 0; i < batch.length; i += chunkSize) {
      const chunk = batch.slice(i, i + chunkSize);
      const results = await Promise.all(
        chunk.map(async (item) => {
          try {
            // Ensure issuerName is set from supplierName if missing
            const issuerName = item.issuerName || item.supplierName || null;

            // Check for existing record to track status changes
            const existingRecord = await prisma.wP_INBOUND_STATUS.findUnique({
              where: { uuid: item.uuid },
              select: {
                status: true,
                dateTimeValidated: true,
                documentStatusReason: true,
                updated_at: true
              }
            });

            // Determine if this is a status change
            const isStatusChange = existingRecord && (
              existingRecord.status !== item.status ||
              existingRecord.dateTimeValidated !== formatDate(item.dateTimeValidated) ||
              existingRecord.documentStatusReason !== item.documentStatusReason
            );

            // WP_INBOUND_STATUS.uuid is the LHDN document identifier (PK). LHDN returns it for all
            // outcomes so we can call getDocument/details/validation; only Valid docs have an official
            // IRBM Unique Identifier No. for display purposes (see documents/recent: irbmUniqueIdentifierNo).
            await withTransaction(async (tx) => {
              return await tx.wP_INBOUND_STATUS.upsert({
                where: { uuid: item.uuid },
                update: {
                  submissionUid: item.submissionUid,
                  longId: item.longId,
                  internalId: item.internalId,
                  typeName: item.typeName,
                  typeVersionName: item.typeVersionName,
                  issuerTin: item.issuerTin || item.supplierTin || null,
                  issuerName: issuerName,
                  receiverId:
                    item.receiverId || item.buyerTin || item.buyerTIN || null,
                  receiverName: item.receiverName || item.buyerName || null,
                  dateTimeReceived: formatDate(item.dateTimeReceived),
                  dateTimeValidated: formatDate(item.dateTimeValidated),
                  status: item.status,
                  documentStatusReason: item.documentStatusReason,
                  updated_at: new Date().toISOString(),
                  totalSales:
                    item.totalSales || item.total || item.netAmount || 0,
                  totalExcludingTax: item.totalExcludingTax || 0,
                  totalDiscount: item.totalDiscount || 0,
                  totalNetAmount: item.totalNetAmount || item.netAmount || 0,
                  totalPayableAmount:
                    item.totalPayableAmount || item.total || 0,
                  documentCurrency:
                    item.documentCurrency ||
                    item.currency ||
                    item.currencyCode ||
                    item.documentCurrencyCode ||
                    null,
                  last_sync_date: formatDate(new Date()),
                  sync_status: "success",
                },
                create: {
                  uuid: item.uuid,
                  submissionUid: item.submissionUid,
                  longId: item.longId,
                  internalId: item.internalId,
                  typeName: item.typeName,
                  typeVersionName: item.typeVersionName,
                  issuerTin: item.issuerTin || item.supplierTin || null,
                  issuerName: issuerName,
                  receiverId:
                    item.receiverId || item.buyerTin || item.buyerTIN || null,
                  receiverName: item.receiverName || item.buyerName || null,
                  dateTimeReceived: formatDate(item.dateTimeReceived),
                  dateTimeValidated: formatDate(item.dateTimeValidated),
                  status: item.status,
                  documentStatusReason: item.documentStatusReason,
                  totalSales:
                    item.totalSales || item.total || item.netAmount || 0,
                  totalExcludingTax: item.totalExcludingTax || 0,
                  totalDiscount: item.totalDiscount || 0,
                  totalNetAmount: item.totalNetAmount || item.netAmount || 0,
                  totalPayableAmount:
                    item.totalPayableAmount || item.total || 0,
                  documentCurrency:
                    item.documentCurrency ||
                    item.currency ||
                    item.currencyCode ||
                    item.documentCurrencyCode ||
                    null,
                  last_sync_date: formatDate(new Date()),
                  sync_status: "success",
                  created_at: new Date().toISOString(),
                  updated_at: new Date().toISOString(),
                },
              });
            });

            // Log if we fixed a missing issuerName
            if (!item.issuerName && item.supplierName) {
              // console.log(
              //   `Fixed missing issuerName using supplierName for UUID: ${item.uuid}`
              // );
            }

            // // Generate response file only for valid documents
            // if (item.status === 'Valid') {
            //     const responseResult = await generateResponseFile(item, req);
            //     responseFileResults.push(responseResult);
            // }

            // // Synchronize status between inbound and outbound tables
            // if (item.status === 'Failed') {
            //     // Update the corresponding outbound status record using Prisma
            //     // Note: UUID is not a unique field, so we need to use updateMany instead of update
            //     await withDbRetry(() => prisma.wP_OUTBOUND_STATUS.updateMany({
            //         where: { UUID: item.uuid },
            //         data: {
            //             status: 'Failed',
            //             updated_at: new Date().toISOString(),
            //             submitted_by: req?.session?.user?.username || 'System'
            //         }
            //     }));
            // } else if (item.status === 'Valid') {
            //     // Update the corresponding outbound status record for Valid documents
            //     await withDbRetry(() => prisma.wP_OUTBOUND_STATUS.updateMany({
            //         where: { UUID: item.uuid },
            //         data: {
            //             status: 'Valid',
            //             date_sync: new Date().toISOString(),
            //             updated_at: new Date().toISOString(),
            //             submitted_by: req?.session?.user?.username || 'System'
            //         }
            //     }));
            // } else if (item.status === 'Invalid') {
            //     // Update the corresponding outbound status record for Invalid documents
            //     await withDbRetry(() => prisma.wP_OUTBOUND_STATUS.updateMany({
            //         where: { UUID: item.uuid },
            //         data: {
            //             status: 'Invalid',
            //             updated_at: new Date().toISOString(),
            //             submitted_by: req?.session?.user?.username || 'System'
            //         }
            //     }));
            // } else if (item.status === 'Cancelled') {
            //     // Update the corresponding outbound status record for Cancelled documents
            //     await withDbRetry(() => prisma.wP_OUTBOUND_STATUS.updateMany({
            //         where: { UUID: item.uuid },
            //         data: {
            //             status: 'Cancelled',
            //             date_cancelled: new Date().toISOString(),
            //             updated_at: new Date().toISOString(),
            //             submitted_by: req?.session?.user?.username || 'System'
            //         }
            //     }));
            // }

            // Log status changes for monitoring
            if (isStatusChange) {
              //console.log(`📊 Status change detected for ${item.uuid}: ${existingRecord?.status} → ${item.status}`);

              // Log status change for analytics
              await LoggingService.log({
                description: `Document status changed: ${existingRecord?.status} → ${item.status}`,
                username: req?.session?.user?.username || "System",
                userId: req?.session?.user?.id,
                ipAddress: req?.ip,
                logType: LOG_TYPES.INFO,
                module: MODULES.API,
                action: ACTIONS.UPDATE,
                status: STATUS.SUCCESS,
                details: {
                  uuid: item.uuid,
                  oldStatus: existingRecord?.status,
                  newStatus: item.status,
                  oldValidated: existingRecord?.dateTimeValidated,
                  newValidated: formatDate(item.dateTimeValidated),
                  statusReason: item.documentStatusReason
                }
              });
            }

            successCount++;
            return { success: true, item, statusChanged: isStatusChange };
          } catch (error) {
            console.error(`Error processing document ${item.uuid}:`, error);
            errorCount++;
            return { success: false, item, error };
          }
        })
      );

      // Log results for this chunk
      // const chunkSuccesses = results.filter((r) => r.success).length;
      // const chunkErrors = results.filter((r) => !r.success).length;
      // console.log(
      //   `Chunk processed: ${chunkSuccesses} successes, ${chunkErrors} errors`
      // );
    }
  }

  // Summarize response file generation results
  const successfulResponses = responseFileResults.filter((r) => r.success);
  if (successfulResponses.length > 0) {
    // console.log(
    //   `Successfully generated ${successfulResponses.length} response files`
    // );
    // successfulResponses.forEach((result) => {
    //   console.log(
    //     `Generated: ${result.fileName} for company ${result.company}`
    //   );
    // });
  }

  // console.log(
  //   `Save operation completed. Success: ${successCount}, Errors: ${errorCount}`
  // );

  return {
    successCount,
    errorCount,
    responseFiles: {
      total: responseFileResults.length,
      successful: successfulResponses.length,
      results: responseFileResults,
    },
  };
};

const requestLogger = async (req, _res, next) => {
  const requestId = Math.random().toString(36).substring(7);
  // console.log(`[${requestId}] New request:`, {
  //   method: req.method,
  //   path: req.path,
  //   params: req.params,
  //   query: req.query,
  //   user: req.session?.user?.id || "anonymous",
  // });
  req.requestId = requestId;
  next();
};

// Function to poll submission status using GetSubmission API
const pollSubmissionStatus = async (submissionUid, maxAttempts = 10) => {
  try {
    if (!submissionUid) {
      throw new Error("Submission UID is required for polling");
    }

    // console.log(`Starting to poll submission status for: ${submissionUid}`);

    // Get LHDN configuration
    const lhdnConfig = await getLHDNConfig();

    // Get token from file - try multiple patterns to be safe
    const tokenFilePath = path.join(
      __dirname,
      "../../config/AuthorizeToken.ini"
    );
    let token = null;

    if (fs.existsSync(tokenFilePath)) {
      const tokenData = fs.readFileSync(tokenFilePath, "utf8");

      // Try different possible token formats in the file
      const tokenPatterns = [
        /AccessToken=(.+)/,
        /access_token=(.+)/,
        /token=(.+)/,
      ];

      for (const pattern of tokenPatterns) {
        const tokenMatch = tokenData.match(pattern);
        if (tokenMatch && tokenMatch[1]) {
          token = tokenMatch[1].trim();
          // console.log(
          //   `Found token in AuthorizeToken.ini using pattern: ${pattern}`
          // );
          break;
        }
      }

      // If we still don't have a token, try parsing as INI
      if (!token && tokenData.includes("[") && tokenData.includes("]")) {
        try {
          const ini = require("ini");
          const parsedIni = ini.parse(tokenData);

          // Check common sections and keys
          if (parsedIni.Token?.AccessToken) {
            token = parsedIni.Token.AccessToken;
          } else if (parsedIni.Token?.access_token) {
            token = parsedIni.Token.access_token;
          } else if (parsedIni.LHDN?.token) {
            token = parsedIni.LHDN.token;
          }

          if (token) {
            // console.log("Found token in AuthorizeToken.ini using INI parsing");
          }
        } catch (iniError) {
          console.error("Error parsing AuthorizeToken.ini:", iniError);
        }
      }
    }

    // If still no token, try to get it from the token service
    if (!token) {
      try {
        // console.log(
        //   "No token found in file, trying to get from token service..."
        // );
        const {
          getTokenSession,
        } = require("../../services/token-prisma.service");
        token = await getTokenSession();

        if (token) {
          // console.log("Successfully retrieved token from token service");
        }
      } catch (tokenServiceError) {
        console.error("Error getting token from service:", tokenServiceError);
      }
    }

    if (!token) {
      throw new Error("No valid access token found for polling");
    }

    let attempts = 0;
    let inProgress = true;
    let submissionStatus = null;

    while (inProgress && attempts < maxAttempts) {
      attempts++;

      try {
        // Call GetSubmission API with proper polling interval
        const response = await axios.get(
          `${lhdnConfig.baseUrl}/api/v1.0/documentsubmissions/${submissionUid}`,
          {
            params: {
              pageNo: 1,
              pageSize: 100, // Maximum allowed page size
            },
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: "application/json",
              "Content-Type": "application/json",
            },
            timeout: lhdnConfig.timeout,
          }
        );

        // Check if submission is still in progress
        submissionStatus = response.data;

        if (
          submissionStatus.overallStatus &&
          submissionStatus.overallStatus.toLowerCase() !== "in progress"
        ) {
          inProgress = false;
          // console.log(
          //   `Submission ${submissionUid} completed with status: ${submissionStatus.overallStatus}`
          // );

          // Process documents in the submission
          if (
            submissionStatus.documentSummary &&
            Array.isArray(submissionStatus.documentSummary)
          ) {
            // console.log(
            //   `Processing ${submissionStatus.documentSummary.length} documents from submission`
            // );

            // Save documents to database
            await saveInboundStatus({
              result: submissionStatus.documentSummary.map((doc) => ({
                ...doc,
                // Ensure consistent field names
                uuid: doc.uuid,
                submissionUid: doc.submissionUid,
                longId: doc.longId,
                internalId: doc.internalId,
                typeName: doc.typeName,
                typeVersionName: doc.typeVersionName,
                issuerTin: doc.issuerTin,
                issuerName: doc.issuerName,
                receiverId: doc.receiverId,
                receiverName: doc.receiverName,
                dateTimeReceived: doc.dateTimeReceived,
                dateTimeValidated: doc.dateTimeValidated,
                status: doc.status,
                documentStatusReason: doc.documentStatusReason,
                totalSales: doc.totalSales || doc.totalPayableAmount,
                totalExcludingTax: doc.totalExcludingTax,
                totalDiscount: doc.totalDiscount,
                totalNetAmount: doc.totalNetAmount,
                totalPayableAmount: doc.totalPayableAmount,
              })),
            });
          }

          return {
            success: true,
            status: submissionStatus.overallStatus,
            documentCount: submissionStatus.documentCount,
            documents: submissionStatus.documentSummary || [],
          };
        }

        // console.log(
        //   `Submission ${submissionUid} still in progress (attempt ${attempts}/${maxAttempts}), waiting...`
        // );

        // Wait for 5 seconds between polling attempts (as recommended by LHDN)
        await delay(5000);
      } catch (error) {
        console.error(
          `Error polling submission status (attempt ${attempts}/${maxAttempts}):`,
          error.message
        );

        // If we get a rate limit error, wait longer
        if (error.response?.status === 429) {
          const retryAfter = parseInt(
            error.response.headers["retry-after"] || "30"
          );
          console.log(
            `Rate limited, waiting ${retryAfter} seconds before retry...`
          );
          await delay(retryAfter * 1000);
        } else {
          // For other errors, wait 5 seconds before retry
          await delay(5000);
        }
      }
    }

    // If we've reached max attempts and still in progress
    if (inProgress) {
     console.log(
        `Reached maximum polling attempts (${maxAttempts}) for submission ${submissionUid}`
      );
      return {
        success: false,
        status: "timeout",
        message: `Polling timed out after ${maxAttempts} attempts`,
        submissionUid,
      };
    }

    return {
      success: true,
      status: submissionStatus?.overallStatus || "unknown",
      documentCount: submissionStatus?.documentCount || 0,
      documents: submissionStatus?.documentSummary || [],
    };
  } catch (error) {
    console.error("Error in pollSubmissionStatus:", error);
    return {
      success: false,
      status: "error",
      message: error.message,
      error,
    };
  }
};

// Import token refresh middleware
const tokenRefreshMiddleware = require("../../middleware/token-refresh.middleware");

// Apply middlewares
router.use(requestLogger);
router.use(tokenRefreshMiddleware);

// Document refresh endpoint
router.post("/documents/refresh", async (req, res) => {
  try {
    //console.log("LHDN documents/refresh endpoint hit");

    // Check if user is logged in
    if (!req.session?.user) {
      //console.log("No user session found");
      return handleAuthError(req, res);
    }

    // Log the refresh request
    await LoggingService.log({
      description: "Manual refresh of LHDN documents requested",
      username: req.session?.user?.username || "System",
      userId: req.session?.user?.id,
      ipAddress: req.ip,
      logType: LOG_TYPES.INFO,
      module: MODULES.API,
      action: ACTIONS.READ,
      status: STATUS.PENDING,
    });

    // Fetch fresh data from LHDN API
    const fetchResult = await fetchRecentDocuments(req);

    // Log the result
    await LoggingService.log({
      description: `Manual refresh completed: ${
        fetchResult.result?.length || 0
      } documents retrieved`,
      username: req.session?.user?.username || "System",
      userId: req.session?.user?.id,
      ipAddress: req.ip,
      logType: LOG_TYPES.INFO,
      module: MODULES.API,
      action: ACTIONS.READ,
      status: STATUS.SUCCESS,
      details: {
        count: fetchResult.result?.length || 0,
        fromApi: fetchResult.fromApi || false,
        fromDatabase: fetchResult.fromDatabase || false,
        cached: fetchResult.cached || false,
      },
    });

    // Return success response
    return res.json({
      success: true,
      message: "Documents refreshed successfully",
      count: fetchResult.result?.length || 0,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error refreshing documents:", error);

    // Log the error
    await LoggingService.log({
      description: `Error refreshing LHDN documents: ${error.message}`,
      username: req.session?.user?.username || "System",
      userId: req.session?.user?.id,
      ipAddress: req.ip,
      logType: LOG_TYPES.ERROR,
      module: MODULES.API,
      action: ACTIONS.READ,
      status: STATUS.FAILED,
      details: { error: error.message },
    });

    // Check if it's an authentication error
    if (
      error.message === "Authentication failed. Please log in again." ||
      error.response?.status === 401 ||
      error.response?.status === 403
    ) {
      return handleAuthError(req, res);
    }

    // Return error response
    return res.status(500).json({
      success: false,
      message: "Failed to refresh documents",
      error: {
        code: error.code || "REFRESH_ERROR",
        message: error.message || "An unexpected error occurred",
        details: error.response?.data?.error || error.stack,
      },
    });
  }
});

/**
 * Invalidate cached LHDN token and obtain a new one (after 401/403).
 */
async function refreshLhdnTokenAfter401(req) {
  const {
    getTokenSession,
    invalidateTokenCache,
    syncSessionLhdnToken,
  } = require("../../services/token-prisma.service");

  markInboundLhdn401Cooldown();
  invalidateTokenCache();
  if (req.session) {
    delete req.session.accessToken;
  }

  const freshToken = await getTokenSession({ forceRefresh: true });
  if (!freshToken) {
    throw new Error("Could not obtain LHDN access token");
  }

  if (req.session) {
    syncSessionLhdnToken(req, freshToken);
  }

  console.log("[LHDN] Obtained new access token after authentication failure");
  return freshToken;
}

function formatDateForDisplay(dateString) {
  if (!dateString) return null;
  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return dateString;
    return date.toISOString();
  } catch (_err) {
    return dateString;
  }
}

function formatDateForUI(dateString) {
  if (!dateString) return null;
  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return null;
    return date.toLocaleString("en-US", {
      month: "short",
      day: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
  } catch (_err) {
    return null;
  }
}

/**
 * Map DB/API rows for inbound UI. Skips per-row UI formatting when lightweight.
 */
function formatInboundDocumentsForResponse(documents, options = {}) {
  if (!documents?.length) {
    return [];
  }
  if (options.lightweight) {
    return documents.map((doc) => {
      const { document, documentDetails, validationResults, ...rest } = doc;
      return {
        ...rest,
        ...extractInboundSstFromRow(doc),
        taxTypeCode: extractInboundTaxTypeFromRow(doc),
      };
    });
  }

  return documents.map((doc) => {
    const receivedDate = doc.dateTimeReceived || doc.created_at;
    const validatedDate = doc.dateTimeValidated;
    let processingTimeMinutes = null;
    if (receivedDate && validatedDate) {
      try {
        const received = new Date(receivedDate);
        const validated = new Date(validatedDate);
        if (!isNaN(received.getTime()) && !isNaN(validated.getTime())) {
          processingTimeMinutes = (validated - received) / (1000 * 60);
        }
      } catch (_e) {
        processingTimeMinutes = null;
      }
    }
    const statusNorm = (doc.status || "").toLowerCase();
    const isValidDoc = statusNorm === "valid";
    const isInvalidDoc = statusNorm === "invalid";

    return {
      uuid: doc.uuid,
      irbmUniqueIdentifierNo: isValidDoc ? doc.uuid : null,
      submissionUid: doc.submissionUid,
      longId: doc.longId,
      internalId: doc.internalId,
      dateTimeIssued: formatDateForDisplay(doc.dateTimeIssued),
      dateTimeReceived: formatDateForDisplay(receivedDate),
      dateTimeValidated: formatDateForDisplay(validatedDate),
      submissionDate: formatDateForDisplay(receivedDate),
      validationDate: formatDateForDisplay(validatedDate),
      receivedDateFormatted: formatDateForUI(receivedDate),
      validatedDateFormatted: formatDateForUI(validatedDate),
      dateInfo: {
        date: formatDateForUI(validatedDate || receivedDate),
        type:
          isValidDoc && validatedDate
            ? "Validated"
            : isInvalidDoc && validatedDate
              ? "Invalid"
              : validatedDate
                ? "Processed"
                : "Submitted",
        tooltip:
          isValidDoc && validatedDate
            ? "LHDN Validation Date"
            : isInvalidDoc && validatedDate
              ? "LHDN response timestamp (document not valid)"
              : validatedDate
                ? "LHDN timestamp"
                : "LHDN Submission Date",
      },
      status: doc.status,
      totalSales: doc.totalSales || 0,
      totalExcludingTax: doc.totalExcludingTax || 0,
      totalDiscount: doc.totalDiscount || 0,
      totalNetAmount: doc.totalNetAmount || 0,
      totalPayableAmount: doc.totalPayableAmount || 0,
      issuerTin: doc.issuerTin,
      issuerName: doc.issuerName,
      receiverId: doc.receiverId,
      receiverName: doc.receiverName,
      supplierName: doc.issuerName,
      typeName: doc.typeName,
      typeVersionName: doc.typeVersionName,
      documentStatusReason: doc.documentStatusReason,
      documentCurrency:
        doc.documentCurrency || doc.currency || doc.currencyCode || "MYR",
      processingTimeMinutes,
      ...extractInboundSstFromRow(doc),
      taxTypeCode: extractInboundTaxTypeFromRow(doc),
    };
  });
}

function collectTaxTypeCodesFromUbl(parsed) {
  const codes = new Set();
  const invoice = parsed?.Invoice?.[0];
  if (!invoice) return codes;

  for (const sub of invoice.TaxTotal?.[0]?.TaxSubtotal || []) {
    const code = sub?.TaxCategory?.[0]?.ID?.[0]?._;
    if (code) codes.add(String(code));
  }

  for (const line of invoice.InvoiceLine || []) {
    for (const sub of line.TaxTotal?.[0]?.TaxSubtotal || []) {
      const code = sub?.TaxCategory?.[0]?.ID?.[0]?._;
      if (code) codes.add(String(code));
    }
    const itemTax = line?.Item?.[0]?.ClassifiedTaxCategory?.[0]?.ID?.[0]?._;
    if (itemTax) codes.add(String(itemTax));
  }

  return codes;
}

/** SST tax type codes (01–06, E) for inbound list / CSV export */
function extractInboundTaxTypeFromRow(doc) {
  if (!doc || typeof doc !== "object") return "";

  const direct = doc.taxTypeCode || doc.tax_type || doc.taxType;
  if (direct) return String(direct);

  if (doc.documentDetails) {
    const parsed = safeJsonParseInboundColumn(doc.documentDetails);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const summaryCodes = (parsed.taxSummary || [])
        .map((entry) => entry?.taxType || entry?.taxTypeCode)
        .filter(Boolean);
      if (summaryCodes.length) {
        return [...new Set(summaryCodes.map(String))].join(", ");
      }

      const lineCodes = (parsed.lineItems || [])
        .map((item) => item?.taxType || item?.taxTypeCode || item?.TaxType)
        .filter(Boolean);
      if (lineCodes.length) {
        return [...new Set(lineCodes.map(String))].join(", ");
      }

      if (parsed.parsedDocument) {
        const ublCodes = collectTaxTypeCodesFromUbl(parsed.parsedDocument);
        if (ublCodes.size) return [...ublCodes].join(", ");
      }
    }
  }

  if (doc.document) {
    const parsed = safeJsonParseInboundColumn(doc.document);
    const ublCodes = collectTaxTypeCodesFromUbl(parsed);
    if (ublCodes.size) return [...ublCodes].join(", ");
  }

  return "";
}

// Helper function to read token from file
async function readTokenFromFile() {
  try {
    const tokenFilePath = path.join(
      __dirname,
      "../../config/AuthorizeToken.ini"
    );
    if (fs.existsSync(tokenFilePath)) {
      const tokenData = await fsPromises.readFile(tokenFilePath, "utf8");

      // Try different possible token formats in the file
      let tokenMatch =
        tokenData.match(/AccessToken=(.+)/i) ||
        tokenData.match(/access_token=(.+)/i) ||
        tokenData.match(/token=(.+)/i);

      if (tokenMatch && tokenMatch[1]) {
        //console.log("Found token in AuthorizeToken.ini file");
        return tokenMatch[1].trim();
      } else {
        //console.log("Token pattern not found in AuthorizeToken.ini file");
        // Try to parse as JSON if no match found
        try {
          const jsonData = JSON.parse(tokenData);
          if (jsonData.access_token) {
            console.log(
              "Found token in JSON format in AuthorizeToken.ini file"
            );
            return jsonData.access_token;
          }
        } catch (jsonError) {
          // Not JSON format, continue
          console.log("AuthorizeToken.ini is not in JSON format");
        }
      }
    } else {
      console.log("AuthorizeToken.ini file not found");
    }
    return null;
  } catch (error) {
    console.error("Error reading token from file:", error);
    return null;
  }
}

// Routes
router.get("/documents/recent", async (req, res) => {
  console.log("LHDN documents/recent endpoint hit");
  try {
    // Check if user is logged in
    if (!req.session?.user) {
      console.log("No user session found");
      return handleAuthError(req, res);
    }

    console.log("User from session:", req.session.user);

    // Check if we should use database only (for fallback)
    const useDatabase = req.query.useDatabase === "true";
    const fallbackOnly = req.query.fallbackOnly === "true";
    const useCache = req.query.useCache === "true";
    const incremental = req.query.incremental === "true";

    // If fallbackOnly is true, skip token check and API call
    if (fallbackOnly) {
      console.log(
        "Fallback only mode requested, skipping token check and API call"
      );
      try {
        if (wantsInboundPagination(req)) {
          const page = await queryInboundListPage(req);
          const lightweight = req.query.lightweight !== "false";
          const formatted = formatInboundDocumentsForResponse(page.rows, {
            lightweight,
          });
          console.log(
            `Found ${page.recordsTotal} documents in database for fallback (page ${formatted.length} rows)`
          );
          return res.json(
            buildInboundPaginatedJson(page, formatted, {
              fromDatabase: true,
              fromApi: false,
              fallback: true,
              timestamp: new Date().toISOString(),
            })
          );
        }

        const dbDocuments = await prisma.wP_INBOUND_STATUS.findMany({
          select: INBOUND_LIST_SELECT,
          orderBy: {
            dateTimeReceived: "desc",
          },
        });

        if (dbDocuments && dbDocuments.length > 0) {
          console.log(
            `Found ${dbDocuments.length} documents in database for fallback`
          );
          return res.json({
            success: true,
            result: dbDocuments,
            metadata: {
              total: dbDocuments.length,
              fromDatabase: true,
              fromApi: false,
              fallback: true,
              timestamp: new Date().toISOString(),
            },
          });
        }

        return res.json({
          success: true,
          result: [],
          metadata: {
            total: 0,
            fromDatabase: true,
            fromApi: false,
            fallback: true,
            timestamp: new Date().toISOString(),
          },
        });
      } catch (dbError) {
        console.error("Error getting documents from database:", dbError);
        return res.status(500).json({
          success: false,
          message: "Error getting documents from database",
          error: {
            code: "DATABASE_ERROR",
            message: dbError.message,
          },
        });
      }
    }

    const {
      resolveLhdnAccessToken,
      syncSessionLhdnToken,
    } = require("../../services/token-prisma.service");

    let accessToken;
    try {
      accessToken = await resolveLhdnAccessToken(req);
      syncSessionLhdnToken(req, accessToken);
    } catch (tokenError) {
      console.error("Error resolving LHDN access token:", tokenError);
      accessToken = null;
    }

    if (!accessToken) {
      console.log("No access token found after all attempts");

      // If useDatabase is true OR incremental is true, try to get documents from database instead of returning error
      if (useDatabase || incremental) {
        try {
          if (wantsInboundPagination(req)) {
            const page = await queryInboundListPage(req);
            const lightweight = req.query.lightweight !== "false";
            const formatted = formatInboundDocumentsForResponse(page.rows, {
              lightweight,
            });
            console.log(
              `Found ${page.recordsTotal} documents in database as fallback for missing token`
            );
            return res.json(
              buildInboundPaginatedJson(page, formatted, {
                fromDatabase: true,
                fromApi: false,
                fallback: true,
                timestamp: new Date().toISOString(),
              })
            );
          }

          const dbDocuments = await prisma.wP_INBOUND_STATUS.findMany({
            select: INBOUND_LIST_SELECT,
            orderBy: {
              dateTimeReceived: "desc",
            },
          });

          if (dbDocuments && dbDocuments.length > 0) {
            console.log(
              `Found ${dbDocuments.length} documents in database as fallback for missing token`
            );
            return res.json({
              success: true,
              result: dbDocuments,
              metadata: {
                total: dbDocuments.length,
                fromDatabase: true,
                fromApi: false,
                fallback: true,
                timestamp: new Date().toISOString(),
              },
            });
          }
        } catch (dbError) {
          console.error("Error getting documents from database:", dbError);
        }
      }

      return handleAuthError(req, res);
    }

    try {
      // If useCache is true, return a signal to use cached data
      if (useCache) {
        console.log("Client requested to use cached data");
        return res.json({
          success: true,
          useCache: true,
          result: [], // Empty result, client will use its cached data
          metadata: {
            cached: true,
            fromCache: true,
            timestamp: new Date().toISOString(),
          },
        });
      }

      // Get documents using enhanced caching function
      const fetchResult = await getCachedDocuments(req);

      if (!fetchResult.success && fetchResult.error) {
        // If fetch failed and no fallback data, return error
        if (!fetchResult.result || fetchResult.result.length === 0) {
          const statusCode = fetchResult.error?.response?.status || 500;
          return res.status(statusCode).json({
            success: false,
            error: {
              code: fetchResult.error.code || "FETCH_ERROR",
              message: fetchResult.error.message || "Failed to fetch documents",
              details: fetchResult.error.details || fetchResult.error.stack,
            },
            metadata: {
              timestamp: new Date().toISOString(),
            },
          });
        }
        // If fetch failed but fallback data is available, log warning and proceed
        console.warn(
          "Fetch from API failed, but using database fallback:",
          fetchResult.error.message
        );
      }

      if (fetchResult.staleSync || fetchResult.supersededSync) {
        if (wantsInboundPagination(req)) {
          const page = await queryInboundListPage(req);
          const lightweight = req.query.lightweight !== "false";
          const formatted = formatInboundDocumentsForResponse(page.rows, {
            lightweight,
          });
          return res.json(
            buildInboundPaginatedJson(page, formatted, {
              supersededSync: true,
              staleSync: true,
              fromDatabase: true,
              fromApi: fetchResult.fromApi ?? true,
              timestamp: new Date().toISOString(),
            })
          );
        }
        return res.json({
          success: true,
          result: fetchResult.result || [],
          metadata: {
            supersededSync: true,
            staleSync: true,
            timestamp: new Date().toISOString(),
          },
        });
      }

      const documents = fetchResult.result || [];
      console.log("Got documents from fetchResult, count:", documents.length);

      const formattedDocuments = formatInboundDocumentsForResponse(
        documents,
        { lightweight: true }
      );

      console.log(
        `Sending response with lightweight documents:`,
        formattedDocuments.length
      );

      const baseMetadata = {
        cached: fetchResult.cached,
        fromDatabase: fetchResult.fromDatabase,
        fromApi: fetchResult.fromApi,
        fallback: fetchResult.fallback,
        error: fetchResult.error
          ? { message: fetchResult.error.message }
          : undefined,
        timestamp: new Date().toISOString(),
      };

      if (fetchResult.paginated || wantsInboundPagination(req)) {
        let pageRows = formattedDocuments;
        let pageMeta = {
          recordsTotal: fetchResult.recordsTotal ?? 0,
          recordsFiltered: fetchResult.recordsFiltered ?? 0,
          start: fetchResult.start ?? (parseInt(req.query.start, 10) || 0),
          length:
            fetchResult.length ??
            (parseInt(req.query.length, 10) || pageRows.length || 10),
        };

        if (
          pageRows.length === 0 &&
          (pageMeta.recordsTotal > 0 || wantsInboundPagination(req))
        ) {
          const page = await queryInboundListPage(req);
          pageRows = formatInboundDocumentsForResponse(page.rows, {
            lightweight: true,
          });
          pageMeta = {
            recordsTotal: page.recordsTotal,
            recordsFiltered: page.recordsFiltered,
            start: page.start,
            length: page.length,
          };
        }

        return res.json(
          buildInboundPaginatedJson(
            {
              recordsTotal: pageMeta.recordsTotal,
              recordsFiltered: pageMeta.recordsFiltered,
              start: pageMeta.start,
              length: pageMeta.length,
            },
            pageRows,
            baseMetadata
          )
        );
      }

      const LHDN_PAGE_SIZE = 100;
      const needsFullSync =
        formattedDocuments.length === LHDN_PAGE_SIZE;

      res.json({
        success: true,
        result: formattedDocuments,
        metadata: {
          total: formattedDocuments.length,
          needsFullSync,
          ...baseMetadata,
        },
      });
    } catch (error) {
      console.error("Error in documents/recent route processing:", error);

      const statusCode = error.response?.status || 500;
      res.status(statusCode).json({
        success: false,
        error: {
          code: error.code || "INTERNAL_SERVER_ERROR",
          message: error.message || "An unexpected error occurred",
          details:
            error.response?.data?.error || error.original?.message || null,
          timestamp: new Date().toISOString(),
        },
      });
    }
  } catch (error) {
    console.error("Error in route handler:", error);

    // Check if it's an authentication error
    if (
      error.message === "Authentication failed. Please log in again." ||
      error.response?.status === 401 ||
      error.response?.status === 403
    ) {
      return handleAuthError(req, res);
    }

    const statusCode = error.response?.status || 500;
    res.status(statusCode).json({
      success: false,
      error: {
        code: error.code || "INTERNAL_SERVER_ERROR",
        message: error.message || "An unexpected error occurred",
        details: error.response?.data?.error || error.original?.message || null,
        timestamp: new Date().toISOString(),
      },
    });
  }
});

// New Search Documents endpoint - Uses LHDN Search API
// NOTE: Per LHDN best practices, this API is designed for manual auditing and troubleshooting.
// It should NOT be used for continuous ERP reconciliation due to strict rate limits.
// Throttling: 1 Request every 5 Seconds | Rate Limit: 12 RPM
// Reference: https://sdk.myinvois.hasil.gov.my/einvoicingapi/09-search-documents/
router.get("/documents/search", async (req, res) => {
  const requestId = `${req.session?.user?.username || 'unknown'}-${Date.now()}`;
  console.log(`[LHDN Search] Request ${requestId} - Endpoint hit`);
  
  // Check if a search is already in progress
  const lockStatus = searchLock.getStatus();
  if (lockStatus.locked) {
    console.warn(`[LHDN Search] Request ${requestId} - Search already in progress by ${lockStatus.lockedBy} (${Math.round(lockStatus.duration/1000)}s)`);
    return res.status(409).json({
      success: false,
      error: {
        code: 'SEARCH_IN_PROGRESS',
        message: 'A search operation is already in progress. Please wait for it to complete.',
        lockedBy: lockStatus.lockedBy,
        duration: Math.round(lockStatus.duration/1000),
        timestamp: new Date().toISOString()
      }
    });
  }
  
  // Try to acquire lock
  if (!searchLock.acquire(requestId)) {
    console.warn(`[LHDN Search] Request ${requestId} - Failed to acquire lock`);
    return res.status(409).json({
      success: false,
      error: {
        code: 'SEARCH_IN_PROGRESS',
        message: 'A search operation is already in progress. Please wait for it to complete.',
        timestamp: new Date().toISOString()
      }
    });
  }
  
  try {
    // Check if user is logged in
    if (!req.session?.user) {
      console.log("No user session found");
      return handleAuthError(req, res);
    }

    console.log("User from session:", req.session.user);

    // Get access token
    let accessToken = await readTokenFromFile();
    if (!accessToken && req.session.accessToken) {
      accessToken = req.session.accessToken;
    }
    if (!accessToken) {
      try {
        const { getTokenSession } = require("../../services/token-prisma.service");
        accessToken = await getTokenSession();
      } catch (tokenError) {
        console.error("Error getting fresh token:", tokenError);
      }
    }

    if (!accessToken) {
      console.log("No access token found");
      return handleAuthError(req, res);
    }

    // Update session with token
    req.session.accessToken = accessToken;

    // Get last 30 days date range (LHDN API limit)
    const now = new Date();
    const startDate = new Date(now);
    startDate.setDate(now.getDate() - 30);
    const endDate = new Date(now);

    // Format dates as ISO 8601
    const submissionDateFrom = startDate.toISOString();
    const submissionDateTo = endDate.toISOString();

    console.log(`[LHDN Search] Searching documents from ${submissionDateFrom} to ${submissionDateTo}`);

    // Import searchDocuments from lhdnService
    const { searchDocuments } = require("../../services/lhdn/lhdnService");

    // Fetch documents for both Sent and Received
    const allDocuments = [];
    const directions = ['Sent', 'Received'];

    const MAX_PAGES_PER_DIRECTION = 20; // Limit to prevent excessive API calls (2000 documents max per direction)
    
    for (const direction of directions) {
      let pageNo = 1;
      let hasMorePages = true;
      const pageSize = 100; // Max per page

      while (hasMorePages && allDocuments.length < 10000 && pageNo <= MAX_PAGES_PER_DIRECTION) {
        try {
          console.log(`[LHDN Search] Fetching ${direction} documents - page ${pageNo}/${MAX_PAGES_PER_DIRECTION}`);
          
          const searchResult = await searchDocuments({
            submissionDateFrom,
            submissionDateTo,
            direction,
            pageNo,
            pageSize
          }, accessToken);

          if (searchResult.status === 'success' && searchResult.data?.result) {
            const documents = searchResult.data.result;
            allDocuments.push(...documents);
            
            console.log(`[LHDN Search] ${direction} page ${pageNo}: ${documents.length} documents (Total: ${allDocuments.length})`);

            // Check if there are more pages
            if (documents.length < pageSize) {
              hasMorePages = false;
              console.log(`[LHDN Search] No more ${direction} documents (last page had ${documents.length} items)`);
            } else {
              pageNo++;
            }
          } else {
            hasMorePages = false;
          }
        } catch (searchError) {
          console.error(`[LHDN Search] Error fetching ${direction} page ${pageNo}:`, searchError.message);
          
          // If it's a rate limit error after retries, stop gracefully
          if (searchError.message.includes('Rate limit exceeded')) {
            console.log(`[LHDN Search] Stopping ${direction} fetch due to rate limiting. Collected ${allDocuments.length} documents so far.`);
          }
          hasMorePages = false;
        }
      }
      
      if (pageNo > MAX_PAGES_PER_DIRECTION) {
        console.log(`[LHDN Search] Reached maximum page limit (${MAX_PAGES_PER_DIRECTION}) for ${direction} documents`);
      }
    }

    console.log(`[LHDN Search] Total documents fetched: ${allDocuments.length}`);

    // Save all documents to WP_INBOUND_STATUS
    if (allDocuments.length > 0) {
      let savedCount = 0;
      let errorCount = 0;

      for (const doc of allDocuments) {
        try {
          // Log first document to see what fields are available
          if (allDocuments.indexOf(doc) === 0) {
            console.log("[LHDN Search] Sample document fields:", {
              uuid: doc.uuid,
              // Party fields
              hasIssuerName: !!doc.issuerName,
              hasSupplierName: !!doc.supplierName,
              hasReceiverName: !!doc.receiverName,
              hasBuyerName: !!doc.buyerName,
              hasIssuerTin: !!doc.issuerTin,
              hasSupplierTin: !!doc.supplierTin,
              hasReceiverId: !!doc.receiverId,
              hasBuyerTin: !!doc.buyerTin,
              // Financial fields
              hasTotalSales: !!doc.totalSales,
              hasTotal: !!doc.total,
              hasNetAmount: !!doc.netAmount,
              hasTotalPayableAmount: !!doc.totalPayableAmount,
              hasPayableAmount: !!doc.payableAmount,
              partyFields: Object.keys(doc).filter(k => 
                k.toLowerCase().includes('issuer') || 
                k.toLowerCase().includes('supplier') || 
                k.toLowerCase().includes('receiver') || 
                k.toLowerCase().includes('buyer')
              ),
              financialFields: Object.keys(doc).filter(k => 
                k.toLowerCase().includes('total') || 
                k.toLowerCase().includes('amount') || 
                k.toLowerCase().includes('sales') ||
                k.toLowerCase().includes('payable')
              )
            });
          }

          // Map API response to WP_INBOUND_STATUS schema
          // IMPORTANT: LHDN Search API may return supplier/buyer fields instead of issuer/receiver
          const mappedDoc = {
            uuid: doc.uuid || '',
            submissionUid: doc.submissionUid || null,
            longId: doc.longId || null,
            internalId: doc.internalId || null,
            typeName: doc.typeName || null,
            typeVersionName: doc.typeVersionName || null,
            // Map issuerTin with fallbacks (note: API returns supplierTIN with uppercase TIN!)
            issuerTin: doc.issuerTin || doc.issuerTIN || doc.supplierTin || doc.supplierTIN || doc.issuerID || null,
            // Map issuerName with fallback to supplierName
            issuerName: doc.issuerName || doc.supplierName || null,
            // Map receiverId with fallbacks (note: API returns buyerTIN and receiverID with uppercase!)
            receiverId: doc.receiverId || doc.receiverID || doc.buyerTin || doc.buyerTIN || null,
            // Map receiverName with fallback to buyerName
            receiverName: doc.receiverName || doc.buyerName || null,
            dateTimeReceived: doc.dateTimeReceived || null,
            dateTimeValidated: doc.dateTimeValidated || null,
            status: doc.status || null,
            documentStatusReason: doc.documentStatusReason || null,
            cancelDateTime: doc.cancelDateTime || null,
            rejectRequestDateTime: doc.rejectRequestDateTime || null,
            dateTimeIssued: doc.dateTimeIssued || null,
            // Map total fields - IMPORTANT: LHDN Search API doesn't return totalSales/total/netAmount!
            // It only returns: totalPayableAmount, totalExcludingTax, totalNetAmount, totalDiscount
            // Use totalPayableAmount as the main total (this is what should be displayed)
            totalSales: parseFloat(doc.totalPayableAmount || doc.totalSales || doc.total || 0),
            totalExcludingTax: parseFloat(doc.totalExcludingTax || doc.taxExclusiveAmount || 0),
            totalDiscount: parseFloat(doc.totalDiscount || doc.discount || 0),
            totalNetAmount: parseFloat(doc.totalNetAmount || doc.netAmount || 0),
            totalPayableAmount: parseFloat(doc.totalPayableAmount || doc.payableAmount || doc.total || 0),
            documentCurrency: doc.documentCurrency || doc.currency || doc.currencyCode || 'MYR',
            last_sync_date: new Date().toISOString(),
            sync_status: 'success',
            updated_at: new Date().toISOString()
          };

          // Upsert to database
          await prisma.wP_INBOUND_STATUS.upsert({
            where: { uuid: mappedDoc.uuid },
            update: mappedDoc,
            create: {
              ...mappedDoc,
              created_at: new Date().toISOString()
            }
          });

          savedCount++;
        } catch (saveError) {
          console.error(`[LHDN Search] Error saving document ${doc.uuid}:`, saveError.message);
          errorCount++;
        }
      }

      console.log(`[LHDN Search] Saved ${savedCount} documents, ${errorCount} errors`);

      // Log the operation
      await LoggingService.log({
        description: `Search API: Fetched and saved ${savedCount} documents`,
        username: req.session?.user?.username || "System",
        userId: req.session?.user?.id,
        ipAddress: req.ip,
        logType: LOG_TYPES.INFO,
        module: MODULES.API,
        action: ACTIONS.READ,
        status: STATUS.SUCCESS,
        details: { 
          totalFetched: allDocuments.length, 
          savedCount, 
          errorCount,
          dateRange: { from: submissionDateFrom, to: submissionDateTo }
        }
      });
    }

    // Return the saved documents from database
    const savedDocuments = await prisma.wP_INBOUND_STATUS.findMany({
      orderBy: {
        dateTimeReceived: "desc",
      },
      take: 9999,
    });

    return res.json({
      success: true,
      result: savedDocuments,
      metadata: {
        total: savedDocuments.length,
        fetched: allDocuments.length,
        fromApi: true,
        fromDatabase: true,
        dateRange: { from: submissionDateFrom, to: submissionDateTo },
        timestamp: new Date().toISOString(),
      },
    });

  } catch (error) {
    console.error("Error in documents/search endpoint:", error);

    // Log the error
    await LoggingService.log({
      description: `Error in search documents: ${error.message}`,
      username: req.session?.user?.username || "System",
      userId: req.session?.user?.id,
      ipAddress: req.ip,
      logType: LOG_TYPES.ERROR,
      module: MODULES.API,
      action: ACTIONS.READ,
      status: STATUS.FAILED,
      details: { error: error.message }
    });

    // Check if it's an authentication error
    if (
      error.message === "Authentication failed. Please log in again." ||
      error.response?.status === 401 ||
      error.response?.status === 403
    ) {
      return handleAuthError(req, res);
    }

    return res.status(500).json({
      success: false,
      message: "Failed to search documents",
      error: {
        code: error.code || "SEARCH_ERROR",
        message: error.message || "An unexpected error occurred",
        details: error.response?.data?.error || error.stack,
      },
    });
  } finally {
    // Always release the lock when request completes (success or error)
    searchLock.release();
  }
});

// Search status endpoint - Check if a search is in progress
router.get("/documents/search-status", async (_req, res) => {
  const status = searchLock.getStatus();
  return res.json({
    success: true,
    searchInProgress: status.locked,
    ...(status.locked && {
      lockedBy: status.lockedBy,
      durationSeconds: Math.round(status.duration / 1000)
    })
  });
});

router.get("/documents/recent-total", async (_req, res) => {
  try {
    const totalCount = await prisma.wP_INBOUND_STATUS.count();
    res.json({ totalCount, success: true });
  } catch (error) {
    console.error("Error getting total count:", error);
    res.json({
      totalCount: 0,
      success: false,
      message: "Failed to fetch recent documents",
    });
  }
});

router.get("/documents/summary", async (req, res) => {
  try {
    if (!req.session?.user) {
      return handleAuthError(req, res);
    }

    const groups = await prisma.wP_INBOUND_STATUS.groupBy({
      by: ["status"],
      _count: { status: true },
    });

    const summary = summarizeInboundStatusGroups(groups);

    res.json({
      success: true,
      summary,
    });
  } catch (error) {
    console.error("Error getting inbound documents summary:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch inbound summary",
    });
  }
});

// Outbound status endpoint - Get all documents from WP_OUTBOUND_STATUS table
router.get("/documents/outbound-status", async (req, res) => {
  try {
    console.log("Fetching outbound status data from WP_OUTBOUND_STATUS");

    // Get all records from WP_OUTBOUND_STATUS table
    const outboundRecords = await prisma.wP_OUTBOUND_STATUS.findMany({
      select: {
        uuid: true,
        submissionUid: true,
        longId: true,
        invoice_number: true,
        fileName: true,
        status: true,
        type: true,
        company: true,
        date: true,
        created_at: true,
        updated_at: true,
        filePath: true,
        errorMessage: true,
        validationResults: true,
      },
      orderBy: {
        created_at: "desc",
      },
    });

    console.log(`Found ${outboundRecords.length} outbound status records`);

    // Map the data to match the expected inbound format
    const mappedRecords = outboundRecords.map((record) => ({
      uuid: record.uuid,
      submissionUid: record.submissionUid,
      longId: record.longId,
      internalId: record.invoice_number,
      typeName: 'Invoice',
      typeVersionName: '1.0',
      issuerTin: null, // Not available in outbound table
      issuerName: record.company || 'Unknown',
      receiverId: null, // Not available in outbound table
      receiverName: null, // Not available in outbound table
      dateTimeReceived: record.created_at,
      dateTimeValidated: record.updated_at,
      status: record.status,
      documentStatusReason: record.errorMessage,
      cancelDateTime: null,
      rejectRequestDateTime: null,
      createdByUserId: null,
      dateTimeIssued: record.date ? new Date(record.date) : record.created_at,
      totalSales: null, // Not available in outbound table
      totalExcludingTax: null,
      totalDiscount: null,
      totalNetAmount: null,
      totalPayableAmount: null,
      last_sync_date: record.updated_at,
      sync_status: 'synced',
      documentDetails: null,
      created_at: record.created_at,
      updated_at: record.updated_at,
      document: null,
      validationResults: record.validationResults,
      // Additional outbound-specific fields
      fileName: record.fileName,
      filePath: record.filePath,
      documentType: record.type,
    }));

    res.json({
      success: true,
      result: mappedRecords,
      totalCount: mappedRecords.length,
      source: 'WP_OUTBOUND_STATUS',
      message: "Outbound status data retrieved successfully",
    });
  } catch (error) {
    console.error("Error fetching outbound status data:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch outbound status data",
      details: error.message,
    });
  }
});

// Archive staging endpoint - Get all documents from WP_INBOUND_STATUS table
router.get("/documents/archive-staging", async (req, res) => {
  try {
    console.log("Fetching archive staging data from WP_INBOUND_STATUS");

    // Get all records from WP_INBOUND_STATUS table
    // Use select to avoid issues with missing columns
    const archiveRecords = await prisma.wP_INBOUND_STATUS.findMany({
      select: {
        uuid: true,
        submissionUid: true,
        longId: true,
        internalId: true,
        typeName: true,
        typeVersionName: true,
        issuerTin: true,
        issuerName: true,
        receiverId: true,
        receiverName: true,
        dateTimeReceived: true,
        dateTimeValidated: true,
        status: true,
        documentStatusReason: true,
        cancelDateTime: true,
        rejectRequestDateTime: true,
        createdByUserId: true,
        dateTimeIssued: true,
        totalSales: true,
        totalExcludingTax: true,
        totalDiscount: true,
        totalNetAmount: true,
        totalPayableAmount: true,
        // documentCurrency: true, // Commented out until column is added
        last_sync_date: true,
        sync_status: true,
        documentDetails: true,
        created_at: true,
        updated_at: true,
        document: true,
        validationResults: true,
      },
      orderBy: {
        dateTimeReceived: "desc",
      },
    });

    console.log(`Found ${archiveRecords.length} archive staging records`);

    // Map the data to match the expected format
    const mappedRecords = archiveRecords.map((record) => ({
      uuid: record.uuid,
      submissionUid: record.submissionUid,
      longId: record.longId,
      internalId: record.internalId,
      typeName: record.typeName,
      typeVersionName: record.typeVersionName,
      issuerTin: record.issuerTin,
      issuerName: record.issuerName || record.supplierName,
      receiverId: record.receiverId,
      receiverName: record.receiverName,
      dateTimeReceived: record.dateTimeReceived,
      dateTimeIssued: record.dateTimeIssued,
      dateTimeValidated: record.dateTimeValidated,
      status: record.status,
      documentStatusReason: record.documentStatusReason,
      cancelDateTime: record.cancelDateTime,
      createdByUserId: record.createdByUserId,
      totalSales: record.totalSales,
      totalExcludingTax: record.totalExcludingTax,
      totalDiscount: record.totalDiscount,
      totalNetAmount: record.totalNetAmount,
      totalPayableAmount: record.totalPayableAmount,
      documentCurrency: record.documentCurrency || "MYR", // Default to MYR if column doesn't exist
      source: "Archive Staging", // Mark as archive staging
      last_sync_date: record.last_sync_date,
    }));

    res.json({
      success: true,
      result: mappedRecords,
      count: mappedRecords.length,
      fromArchive: true,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error fetching archive staging data:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to fetch archive staging data",
      result: [],
    });
  }
});

// New endpoint to check submission status using polling
router.get("/submission/:submissionUid", async (req, res) => {
  try {
    const { submissionUid } = req.params;
    const maxAttempts = parseInt(req.query.maxAttempts) || 10;

    if (!submissionUid) {
      return res.status(400).json({
        success: false,
        message: "Submission UID is required",
      });
    }

    // Check if user is logged in
    if (!req.session?.user) {
      console.log("No user session found");
      return handleAuthError(req, res);
    }

    // Log the request
    await LoggingService.log({
      description: `Checking submission status for: ${submissionUid}`,
      username: req.session?.user?.username || "System",
      userId: req.session?.user?.id,
      ipAddress: req.ip,
      logType: LOG_TYPES.INFO,
      module: MODULES.API,
      action: ACTIONS.READ,
      status: STATUS.PENDING,
    });

    // Poll for submission status
    const result = await pollSubmissionStatus(submissionUid, maxAttempts);

    // Log the result
    await LoggingService.log({
      description: `Submission status check completed for: ${submissionUid}, status: ${result.status}`,
      username: req.session?.user?.username || "System",
      userId: req.session?.user?.id,
      ipAddress: req.ip,
      logType: LOG_TYPES.INFO,
      module: MODULES.API,
      action: ACTIONS.READ,
      status: result.success ? STATUS.SUCCESS : STATUS.FAILED,
      details: {
        submissionUid,
        status: result.status,
        documentCount: result.documentCount || 0,
      },
    });

    return res.json(result);
  } catch (error) {
    console.error("Error checking submission status:", error);

    // Log the error
    await LoggingService.log({
      description: `Error checking submission status: ${error.message}`,
      username: req.session?.user?.username || "System",
      userId: req.session?.user?.id,
      ipAddress: req.ip,
      logType: LOG_TYPES.ERROR,
      module: MODULES.API,
      action: ACTIONS.READ,
      status: STATUS.FAILED,
      details: { error: error.message },
    });

    return res.status(500).json({
      success: false,
      status: "error",
      message: error.message,
    });
  }
});

// Validation results endpoint
router.get('/documents/:uuid/validation-results', async (req, res) => {
    try {
        const { uuid } = req.params;
        const requestId = req.requestId;

        console.log(`[${requestId}] Fetching validation results for document: ${uuid}`);

        // Check if user is logged in
        if (!req.session?.user) {
            console.log(`[${requestId}] No user session found`);
            return handleAuthError(req, res);
        }

        // Get LHDN configuration
        const lhdnConfig = await getLHDNConfig();

        // Log the request
        await LoggingService.log({
            description: `Fetching validation results for document: ${uuid}`,
            username: req.session?.user?.username || 'System',
            userId: req.session?.user?.id,
            ipAddress: req.ip,
            logType: LOG_TYPES.INFO,
            module: MODULES.API,
            action: ACTIONS.READ,
            status: STATUS.PENDING
        });

        // First check if we have the validation results in the database
        const dbDocument = await prisma.wP_INBOUND_STATUS.findUnique({
            where: { uuid }
        });

        if (dbDocument && dbDocument.validationResults) {
            console.log(`[${requestId}] Found validation results in database for document: ${uuid}`);

            try {
                // Parse validation results
                const validationResults = JSON.parse(dbDocument.validationResults);

                // Log success
                await LoggingService.log({
                    description: `Successfully retrieved validation results from database for document: ${uuid}`,
                    username: req.session?.user?.username || 'System',
                    userId: req.session?.user?.id,
                    ipAddress: req.ip,
                    logType: LOG_TYPES.INFO,
                    module: MODULES.API,
                    action: ACTIONS.READ,
                    status: STATUS.SUCCESS
                });

                return res.json({
                    success: true,
                    validationResults,
                    source: 'database'
                });
            } catch (parseError) {
                console.error(`[${requestId}] Error parsing validation results from database:`, parseError);
                // Continue to fetch from API if parsing fails
            }
        }

        // If not in database or parsing failed, fetch from API
        console.log(`[${requestId}] Fetching validation results from LHDN API for document: ${uuid}`);

        // Get document details from LHDN API
        const response = await axios.get(`${lhdnConfig.baseUrl}/api/v1.0/documents/${uuid}/details`, {
            headers: {
                'Authorization': `Bearer ${req.session.accessToken}`,
                'Content-Type': 'application/json'
            }
        });

        const detailsData = response.data;

        // Process validation results with enhanced error mapping
        let processedValidationResults = null;
        if (detailsData.validationResults) {
            // Load LHDN error mapper for better error messages
            let lhdnErrorMapper = null;
            try {
                lhdnErrorMapper = require('../../services/lhdn/lhdnErrorMapper');
            } catch (error) {
                console.error('Failed to load LHDNErrorMapper:', error);
            }

            processedValidationResults = {
                status: detailsData.status,
                validationSteps: detailsData.validationResults.validationSteps?.map(step => {
                    let errors = [];
                    if (step.error) {
                        if (Array.isArray(step.error.errors)) {
                            errors = step.error.errors.map(err => {
                                // Enhanced error processing with LHDN error mapping
                                const errorCode = err.code || 'VALIDATION_ERROR';
                                const originalMessage = err.message || err.toString();

                                // Apply error mapping if available
                                let mappedError = null;
                                if (lhdnErrorMapper && (originalMessage === '[object Object]' || originalMessage.includes('[object Object]'))) {
                                    mappedError = lhdnErrorMapper.mapError(errorCode, originalMessage, step.name);
                                }

                                return {
                                    code: errorCode,
                                    message: mappedError ? mappedError.userMessage : originalMessage,
                                    userMessage: mappedError ? mappedError.userMessage : originalMessage,
                                    guidance: mappedError ? mappedError.guidance : null,
                                    severity: mappedError ? mappedError.severity : 'error',
                                    field: err.field || 'Not specified',
                                    value: err.value || null,
                                    details: mappedError ? mappedError.guidance?.join('; ') : (err.details || 'Document validation failed. Please check the document format and required fields.'),
                                    _technical: mappedError ? {
                                        originalMessage: originalMessage,
                                        technicalMessage: mappedError.technicalMessage,
                                        processedFromAPI: true
                                    } : null
                                };
                            });
                        } else if (typeof step.error === 'object') {
                            const errorCode = step.error.code || 'VALIDATION_ERROR';
                            const originalMessage = step.error.message || step.error.toString();

                            let mappedError = null;
                            if (lhdnErrorMapper && (originalMessage === '[object Object]' || originalMessage.includes('[object Object]'))) {
                                mappedError = lhdnErrorMapper.mapError(errorCode, originalMessage, step.name);
                            }

                            errors = [{
                                code: errorCode,
                                message: mappedError ? mappedError.userMessage : originalMessage,
                                userMessage: mappedError ? mappedError.userMessage : originalMessage,
                                guidance: mappedError ? mappedError.guidance : null,
                                severity: mappedError ? mappedError.severity : 'error',
                                field: step.error.field || 'Not specified',
                                value: step.error.value || null,
                                details: mappedError ? mappedError.guidance?.join('; ') : (step.error.details || 'Document validation failed. Please check the document format and required fields.'),
                                _technical: mappedError ? {
                                    originalMessage: originalMessage,
                                    technicalMessage: mappedError.technicalMessage,
                                    processedFromAPI: true
                                } : null
                            }];
                        } else {
                            errors = [{
                                code: 'VALIDATION_ERROR',
                                message: 'Document validation failed. Please check the document format and required fields.',
                                userMessage: 'Document validation failed. Please check the document format and required fields.',
                                field: 'Not specified',
                                value: null,
                                details: 'Document validation failed. Please check the document format and required fields.',
                                severity: 'error'
                            }];
                        }
                    }

                    return {
                        name: step.name || 'Validation Step',
                        status: step.status || 'Invalid',
                        error: errors.length > 0 ? { errors } : null,
                        timestamp: step.timestamp || new Date().toISOString()
                    };
                }) || [],
                summary: {
                    totalSteps: detailsData.validationResults.validationSteps?.length || 0,
                    failedSteps: detailsData.validationResults.validationSteps?.filter(step => step.status === 'Invalid' || step.error)?.length || 0,
                    lastUpdated: new Date().toISOString()
                }
            };

            // Save validation results to database
            try {
                await prisma.wP_INBOUND_STATUS.update({
                    where: { uuid },
                    data: {
                        validationResults: JSON.stringify(processedValidationResults)
                    }
                });
                console.log(`[${requestId}] Saved validation results to database for document: ${uuid}`);
            } catch (dbError) {
                console.error(`[${requestId}] Error saving validation results to database:`, dbError);
                // Continue even if saving to database fails
            }
        }

        // Log success
        await LoggingService.log({
            description: `Successfully retrieved validation results from API for document: ${uuid}`,
            username: req.session?.user?.username || 'System',
            userId: req.session?.user?.id,
            ipAddress: req.ip,
            logType: LOG_TYPES.INFO,
            module: MODULES.API,
            action: ACTIONS.READ,
            status: STATUS.SUCCESS
        });

        return res.json({
            success: true,
            validationResults: processedValidationResults,
            source: 'api'
        });
    } catch (error) {
        console.error('Error fetching validation results:', error);

        // Log the error
        await LoggingService.log({
            description: `Error fetching validation results: ${error.message}`,
            username: req.session?.user?.username || 'System',
            userId: req.session?.user?.id,
            ipAddress: req.ip,
            logType: LOG_TYPES.ERROR,
            module: MODULES.API,
            action: ACTIONS.READ,
            status: STATUS.FAILED,
            details: { error: error.message }
        });

        // Check if it's an authentication error
        if (error.message === 'Authentication failed. Please log in again.' ||
            error.response?.status === 401 ||
            error.response?.status === 403) {
            return handleAuthError(req, res);
        }

        return res.status(500).json({
            success: false,
            message: 'Failed to fetch validation results',
            error: {
                code: error.code || 'VALIDATION_ERROR',
                message: error.message || 'An unexpected error occurred',
                details: error.response?.data?.error || error.stack
            }
        });
    }
});


// // Validation results endpoint
// router.get("/documents/:uuid/validation-results", async (req, res) => {
//   try {
//     const { uuid } = req.params;
//     const { refresh } = req.query; // Add refresh parameter to force API fetch
//     const requestId = req.requestId;

//     console.log(
//       `[${requestId}] Fetching validation results for document: ${uuid}`
//     );

//     // Check if user is logged in
//     if (!req.session?.user) {
//       console.log(`[${requestId}] No user session found`);
//       return handleAuthError(req, res);
//     }

//     // Get LHDN configuration
//     const lhdnConfig = await getLHDNConfig();

//     // Log the request
//     await LoggingService.log({
//       description: `Fetching validation results for document: ${uuid}`,
//       username: req.session?.user?.username || "System",
//       userId: req.session?.user?.id,
//       ipAddress: req.ip,
//       logType: LOG_TYPES.INFO,
//       module: MODULES.API,
//       action: ACTIONS.READ,
//       status: STATUS.PENDING,
//     });

//     // First check if we have the validation results in the database (unless refresh is requested)
//     const dbDocument = await prisma.wP_INBOUND_STATUS.findUnique({
//       where: { uuid },
//     });

//     if (dbDocument && dbDocument.validationResults && !refresh) {
//       console.log(
//         `[${requestId}] Found validation results in database for document: ${uuid}`
//       );

//       try {
//         // Parse validation results
//         const validationResults = JSON.parse(dbDocument.validationResults);

//         // Process cached validation results through our error mapper
//         if (validationResults && validationResults.validationSteps) {
//           console.log(`[${requestId}] Processing cached validation results through error mapper`);

//           validationResults.validationSteps = validationResults.validationSteps.map((step, index) => {
//             if (step.error && step.error.errors) {
//               console.log(`[${requestId}] Processing cached step ${index} errors:`, step.error.errors);

//               step.error.errors = step.error.errors.map((err) => {
//                 // Check if this error needs processing (has [object Object] message)
//                 if (err.message === '[object Object]' || (typeof err.message === 'string' && err.message.includes('[object Object]'))) {
//                   console.log(`[${requestId}] Found [object Object] error in cached data, applying error mapping`);

//                   const errorCode = err.code || "VALIDATION_ERROR";
//                   const mappedError = lhdnErrorMapper.mapError(errorCode, err.message, step.name);

//                   return {
//                     ...err,
//                     message: mappedError.userMessage,
//                     userMessage: mappedError.userMessage,
//                     guidance: mappedError.guidance,
//                     severity: mappedError.severity,
//                     details: mappedError.guidance ? mappedError.guidance.join('; ') : err.details,
//                     _technical: {
//                       originalMessage: err.message,
//                       technicalMessage: mappedError.technicalMessage,
//                       processedFromCache: true
//                     }
//                   };
//                 }
//                 return err;
//               });
//             }
//             return step;
//           });
//         }

//         // Log success
//         await LoggingService.log({
//           description: `Successfully retrieved validation results from database for document: ${uuid}`,
//           username: req.session?.user?.username || "System",
//           userId: req.session?.user?.id,
//           ipAddress: req.ip,
//           logType: LOG_TYPES.INFO,
//           module: MODULES.API,
//           action: ACTIONS.READ,
//           status: STATUS.SUCCESS,
//         });

//         return res.json({
//           success: true,
//           validationResults,
//           source: "database",
//         });
//       } catch (parseError) {
//         console.error(
//           `[${requestId}] Error parsing validation results from database:`,
//           parseError
//         );
//         // Continue to fetch from API if parsing fails
//       }
//     }

//     // If not in database or parsing failed, fetch from API
//     console.log(
//       `[${requestId}] Fetching validation results from LHDN API for document: ${uuid}`
//     );

//     // Get document details from LHDN API
//     const response = await axios.get(
//       `${lhdnConfig.baseUrl}/api/v1.0/documents/${uuid}/details`,
//       {
//         headers: {
//           Authorization: `Bearer ${req.session.accessToken}`,
//           "Content-Type": "application/json",
//         },
//       }
//     );

//     const detailsData = response.data;

//     // Process validation results
//     let processedValidationResults = null;
//     if (detailsData.validationResults) {
//       console.log('Raw validation results from LHDN:', JSON.stringify(detailsData.validationResults, null, 2));

//       // Additional debugging for error structures
//       if (detailsData.validationResults?.validationSteps) {
//         detailsData.validationResults.validationSteps.forEach((step, index) => {
//           if (step.error) {
//             console.log(`Raw LHDN Step ${index} error structure:`, JSON.stringify(step.error, null, 2));
//             console.log(`Raw LHDN Step ${index} error type:`, typeof step.error);
//             console.log(`Raw LHDN Step ${index} error keys:`, Object.keys(step.error));

//             if (step.error.errors && Array.isArray(step.error.errors)) {
//               step.error.errors.forEach((err, errIndex) => {
//                 console.log(`Raw LHDN Step ${index} Error ${errIndex}:`, JSON.stringify(err, null, 2));
//                 console.log(`Raw LHDN Step ${index} Error ${errIndex} type:`, typeof err);
//                 if (err.message) {
//                   console.log(`Raw LHDN Step ${index} Error ${errIndex} message:`, err.message);
//                   console.log(`Raw LHDN Step ${index} Error ${errIndex} message type:`, typeof err.message);
//                 }
//               });
//             }
//           }
//         });
//       }

//       processedValidationResults = {
//         status: detailsData.status,
//         validationSteps:
//           detailsData.validationResults.validationSteps?.map((step, index) => {
//             console.log(`Processing validation step ${index}:`, JSON.stringify(step, null, 2));
//             let errors = [];
//             if (step.error) {
//               console.log(`Step ${index} has error:`, JSON.stringify(step.error, null, 2));
//               // Helper function to extract meaningful error message
//               const extractErrorMessage = (errorObj) => {
//                 console.log('Extracting error message from:', errorObj, 'Type:', typeof errorObj);

//                 if (typeof errorObj === 'string') {
//                   // Handle [object Object] case
//                   if (errorObj === '[object Object]') {
//                     return 'Document validation failed. Please check the document format and try again.';
//                   }
//                   return errorObj;
//                 }

//                 if (typeof errorObj === 'object' && errorObj !== null) {
//                   // Log the object structure for debugging
//                   console.log('Error object keys:', Object.keys(errorObj));
//                   console.log('Error object values:', Object.values(errorObj));

//                   // Try different common error message properties
//                   if (errorObj.message && typeof errorObj.message === 'string') {
//                     return errorObj.message === '[object Object]' ?
//                       'Document validation failed. Please check the document format and try again.' :
//                       errorObj.message;
//                   }

//                   if (errorObj.message && typeof errorObj.message === 'object') {
//                     // Recursively extract from nested message object
//                     return extractErrorMessage(errorObj.message);
//                   }

//                   if (errorObj.description) return errorObj.description;
//                   if (errorObj.detail) return errorObj.detail;
//                   if (errorObj.errorMessage) return errorObj.errorMessage;
//                   if (errorObj.userMessage) return errorObj.userMessage;
//                   if (errorObj.text) return errorObj.text;

//                   if (errorObj.error) {
//                     return extractErrorMessage(errorObj.error);
//                   }

//                   // Check for LHDN specific error structures
//                   if (errorObj.innerError && Array.isArray(errorObj.innerError)) {
//                     const innerMessages = errorObj.innerError.map(inner => extractErrorMessage(inner)).filter(msg => msg);
//                     if (innerMessages.length > 0) {
//                       return innerMessages.join('; ');
//                     }
//                   }

//                   // If it's an object with properties, try to create a meaningful message
//                   const keys = Object.keys(errorObj);
//                   if (keys.length > 0) {
//                     // Try to create a readable message from the object properties
//                     const meaningfulProps = keys.filter(key =>
//                       typeof errorObj[key] === 'string' &&
//                       errorObj[key].length > 0 &&
//                       errorObj[key] !== '[object Object]'
//                     );

//                     if (meaningfulProps.length > 0) {
//                       return meaningfulProps.map(key => `${key}: ${errorObj[key]}`).join(', ');
//                     }

//                     // Fallback to JSON representation
//                     try {
//                       const jsonStr = JSON.stringify(errorObj, null, 2);
//                       console.log('Error object as JSON:', jsonStr);

//                       // Try to extract meaningful information from the JSON
//                       if (jsonStr.includes('"message"') || jsonStr.includes('"error"')) {
//                         return `Validation error: ${jsonStr}`;
//                       }

//                       return 'Document validation failed. Please check the document format and try again.';
//                     } catch (e) {
//                       console.error('Failed to stringify error object:', e);
//                       return 'Complex validation error (unable to parse)';
//                     }
//                   }
//                 }
//                 return 'Unknown validation error';
//               };

//               if (Array.isArray(step.error.errors)) {
//                 errors = step.error.errors.map((err) => {
//                   const errorCode = err.code || "VALIDATION_ERROR";
//                   const rawMessage = extractErrorMessage(err);
//                   const mappedError = lhdnErrorMapper.mapError(errorCode, rawMessage, step.name);

//                   return {
//                     code: errorCode,
//                     message: mappedError.userMessage,
//                     field: err.field || mappedError.field,
//                     value: err.value || null,
//                     details: mappedError.guidance ? mappedError.guidance.join('; ') : null,
//                     userMessage: mappedError.userMessage,
//                     guidance: mappedError.guidance,
//                     severity: mappedError.severity,
//                     _technical: {
//                       originalMessage: rawMessage,
//                       technicalMessage: mappedError.technicalMessage
//                     }
//                   };
//                 });
//               } else if (typeof step.error === "object") {
//                 const errorCode = step.error.code || "VALIDATION_ERROR";
//                 const rawMessage = extractErrorMessage(step.error);
//                 const mappedError = lhdnErrorMapper.mapError(errorCode, rawMessage, step.name);

//                 errors = [
//                   {
//                     code: errorCode,
//                     message: mappedError.userMessage,
//                     field: step.error.field || mappedError.field,
//                     value: step.error.value || null,
//                     details: mappedError.guidance ? mappedError.guidance.join('; ') : null,
//                     userMessage: mappedError.userMessage,
//                     guidance: mappedError.guidance,
//                     severity: mappedError.severity,
//                     _technical: {
//                       originalMessage: rawMessage,
//                       technicalMessage: mappedError.technicalMessage
//                     }
//                   },
//                 ];
//               } else {
//                 const rawMessage = extractErrorMessage(step.error);
//                 const mappedError = lhdnErrorMapper.mapError("VALIDATION_ERROR", rawMessage, step.name);

//                 errors = [
//                   {
//                     code: "VALIDATION_ERROR",
//                     message: mappedError.userMessage,
//                     field: null,
//                     value: null,
//                     details: mappedError.guidance ? mappedError.guidance.join('; ') : null,
//                     userMessage: mappedError.userMessage,
//                     guidance: mappedError.guidance,
//                     severity: mappedError.severity,
//                     _technical: {
//                       originalMessage: rawMessage,
//                       technicalMessage: mappedError.technicalMessage
//                     }
//                   },
//                 ];
//               }
//             }

//             const processedStep = {
//               name: step.name || "Validation Step",
//               status: step.status || "Invalid",
//               error: errors.length > 0 ? { errors } : null,
//               timestamp: step.timestamp || new Date().toISOString(),
//             };

//             console.log(`Processed step ${index}:`, JSON.stringify(processedStep, null, 2));
//             return processedStep;
//           }) || [],
//         summary: {
//           totalSteps:
//             detailsData.validationResults.validationSteps?.length || 0,
//           failedSteps:
//             detailsData.validationResults.validationSteps?.filter(
//               (step) => step.status === "Invalid" || step.error
//             )?.length || 0,
//           lastUpdated: new Date().toISOString(),
//         },
//       };

//       // Save validation results to database
//       try {
//         await prisma.wP_INBOUND_STATUS.update({
//           where: { uuid },
//           data: {
//             validationResults: JSON.stringify(processedValidationResults),
//             updated_at: new Date().toISOString(),
//           },
//         });
//         console.log(
//           `[${requestId}] Saved validation results to database for document: ${uuid}`
//         );
//       } catch (dbError) {
//         console.error(
//           `[${requestId}] Error saving validation results to database:`,
//           dbError
//         );
//         // Continue even if saving to database fails
//       }
//     }

//     // Log success
//     await LoggingService.log({
//       description: `Successfully retrieved validation results from API for document: ${uuid}`,
//       username: req.session?.user?.username || "System",
//       userId: req.session?.user?.id,
//       ipAddress: req.ip,
//       logType: LOG_TYPES.INFO,
//       module: MODULES.API,
//       action: ACTIONS.READ,
//       status: STATUS.SUCCESS,
//     });

//     const finalResult = {
//       success: true,
//       validationResults: processedValidationResults,
//       source: "api",
//     };

//     console.log('Final API response:', JSON.stringify(finalResult, null, 2));
//     return res.json(finalResult);
//   } catch (error) {
//     console.error("Error fetching validation results:", error);

//     // Log the error
//     await LoggingService.log({
//       description: `Error fetching validation results: ${error.message}`,
//       username: req.session?.user?.username || "System",
//       userId: req.session?.user?.id,
//       ipAddress: req.ip,
//       logType: LOG_TYPES.ERROR,
//       module: MODULES.API,
//       action: ACTIONS.READ,
//       status: STATUS.FAILED,
//       details: { error: error.message },
//     });

//     // Check if it's an authentication error
//     if (
//       error.message === "Authentication failed. Please log in again." ||
//       error.response?.status === 401 ||
//       error.response?.status === 403
//     ) {
//       return handleAuthError(req, res);
//     }

//     return res.status(500).json({
//       success: false,
//       message: "Failed to fetch validation results",
//       error: {
//         code: error.code || "VALIDATION_ERROR",
//         message: error.message || "An unexpected error occurred",
//         details: error.response?.data?.error || error.stack,
//       },
//     });
//   }
// });

// Check LHDN API status
router.get("/status", async (req, res) => {
  try {
    // Get LHDN configuration
    const lhdnConfig = await getLHDNConfig();

    // Get token from session
    const accessToken = await getTokenSession();
    if (!accessToken) {
      return res.status(401).json({
        success: false,
        message: "Failed to get access token",
      });
    }

    // Try to make a simple API call to check if LHDN API is available
    const response = await axios.get(
      `${lhdnConfig.baseUrl}/api/v1.0/documents/status`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        timeout: 5000, // 5 second timeout
      }
    );

    // If we get here, the API is available
    res.json({
      success: true,
      message: "LHDN API is available",
      status: "connected",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error checking LHDN API status:", error);

    // Determine the specific error
    let errorMessage = "LHDN API is unavailable";
    let errorStatus = "disconnected";

    if (error.code === "ECONNABORTED") {
      errorMessage = "Connection to LHDN API timed out";
    } else if (error.response) {
      // The request was made and the server responded with a status code
      // that falls out of the range of 2xx
      errorMessage = `LHDN API returned error: ${error.response.status} ${error.response.statusText}`;

      if (error.response.status === 401 || error.response.status === 403) {
        errorStatus = "unauthorized";
      }
    } else if (error.request) {
      // The request was made but no response was received
      errorMessage = "No response received from LHDN API";
    }

    res.status(503).json({
      success: false,
      message: errorMessage,
      status: errorStatus,
      timestamp: new Date().toISOString(),
    });
  }
});

// Authentication status endpoint - Modified to handle unauthenticated requests better
router.get("/auth-status", async (req, res) => {
  try {
    // This endpoint should always return a 200 status with authentication status
    // to avoid frontend errors, even when not authenticated

    // Check if user is logged in
    if (!req.session?.user) {
      console.log("LHDN auth-status: No active user session");
      return res.status(200).json({
        success: true, // Changed to true to avoid frontend errors
        authenticated: false,
        message: "No active user session",
        code: "SESSION_MISSING",
      });
    }

    // Try to get token from session or file
    const {
      getTokenSession,
      readTokenFromFile,
    } = require("../../services/token-prisma.service");
    let accessToken = req.session.accessToken;

    // If no token in session, try to get from file
    if (!accessToken) {
      try {
        const tokenData = readTokenFromFile();
        if (tokenData && tokenData.access_token) {
          accessToken = tokenData.access_token;
          // Update session with token from file
          req.session.accessToken = accessToken;
          console.log("LHDN auth-status: Using token from file");
        }
      } catch (fileError) {
        console.warn(
          "LHDN auth-status: Error reading token from file:",
          fileError
        );
      }
    }

    // If still no token, try to get a fresh one
    if (!accessToken) {
      try {
        accessToken = await getTokenSession();
        // Update session with new token
        if (accessToken) {
          req.session.accessToken = accessToken;
          console.log("LHDN auth-status: Generated new token");
        }
      } catch (tokenError) {
        console.warn(
          "LHDN auth-status: Error getting fresh token:",
          tokenError
        );
      }
    }

    // Check if we have a token now
    if (!accessToken) {
      console.log("LHDN auth-status: No token available after all attempts");
      return res.status(200).json({
        success: true, // Changed to true to avoid frontend errors
        authenticated: false,
        message: "No LHDN access token available",
        code: "TOKEN_MISSING",
      });
    }

    // Check token expiry if available
    const now = Date.now();
    const tokenExpiry = req.session.tokenExpiryTime || 0;
    const bufferTime = 3 * 60 * 1000; // 3 minutes buffer (reduced from 5)

    if (tokenExpiry && tokenExpiry < now + bufferTime) {
      console.log("LHDN auth-status: Token expired or about to expire");
      // Try to refresh the token
      try {
        const newToken = await getTokenSession();
        if (newToken) {
          accessToken = newToken;
          req.session.accessToken = newToken;
          // Use more conservative expiry time to prevent DC511 errors
          req.session.tokenExpiryTime = now + 45 * 60 * 1000; // 45 minutes instead of 1 hour
          console.log("LHDN auth-status: Successfully refreshed expired token");
        } else {
          return res.status(200).json({
            success: true, // Changed to true to avoid frontend errors
            authenticated: false,
            message: "LHDN access token is expired and refresh failed",
            code: "TOKEN_EXPIRED",
            expiresIn: Math.floor((tokenExpiry - now) / 1000), // seconds until expiry
          });
        }
      } catch (refreshError) {
        console.warn(
          "LHDN auth-status: Failed to refresh expired token:",
          refreshError
        );
        return res.status(200).json({
          success: true, // Changed to true to avoid frontend errors
          authenticated: false,
          message: "LHDN access token is expired and refresh failed",
          code: "TOKEN_EXPIRED",
          expiresIn: Math.floor((tokenExpiry - now) / 1000), // seconds until expiry
        });
      }
    }

    // Since LHDN API doesn't have a dedicated token verification endpoint,
    // we'll assume the token is valid if it exists and hasn't expired
    console.log("LHDN auth-status: Token exists and appears valid");
    return res.status(200).json({
      authenticated: true,
      success: true,
      message: "Authentication valid",
      expiresIn: tokenExpiry ? Math.floor((tokenExpiry - now) / 1000) : null,
    });
  } catch (error) {
    console.error("LHDN auth-status: Error checking auth status:", error);
    return res.status(200).json({
      success: true, // Changed to true to avoid frontend errors
      authenticated: false,
      message: "Error checking authentication status",
      error: error.message,
    });
  }
});

// Sync endpoint
router.get("/sync", async (req, res) => {
  try {
    const apiData = await fetchRecentDocuments(req);
    // Log the start of document fetching
    await LoggingService.log({
      description: "Starting document fetch from LHDN",
      username: req?.session?.user?.username || "System",
      userId: req?.session?.user?.id,
      ipAddress: req?.ip,
      logType: LOG_TYPES.INFO,
      module: MODULES.API,
      action: ACTIONS.READ,
      status: STATUS.PENDING,
    });
    await saveInboundStatus(apiData);

    res.json({ success: true });
  } catch (error) {
    console.error("Error syncing with API:", error);
    res.status(500).json({
      success: false,
      message: `Failed to sync with API: ${error.message}`,
    });
  }
});

// Refresh documents endpoint - Force refresh from LHDN API
router.post("/documents/refresh", async (req, res) => {
  try {
    // Generate a unique request ID for tracking
    const requestId = `refresh-${Date.now()}-${Math.random()
      .toString(36)
      .substring(2, 10)}`;
    console.log(`[${requestId}] Starting document refresh from LHDN API`);

    // Log the start of document fetching
    await LoggingService.log({
      description: "Manually refreshing documents from LHDN",
      username: req?.session?.user?.username || "System",
      userId: req?.session?.user?.id,
      ipAddress: req?.ip,
      logType: LOG_TYPES.INFO,
      module: MODULES.API,
      action: ACTIONS.READ,
      status: STATUS.PENDING,
      details: { requestId },
    });

    // Force fetch from API by setting forceRefresh flag
    req.query.forceRefresh = "true";
    const apiData = await fetchRecentDocuments(req);

    // Save to database
    await saveInboundStatus(apiData);

    // Log success
    await LoggingService.log({
      description: "Successfully refreshed documents from LHDN",
      username: req?.session?.user?.username || "System",
      userId: req?.session?.user?.id,
      ipAddress: req?.ip,
      logType: LOG_TYPES.INFO,
      module: MODULES.API,
      action: ACTIONS.READ,
      status: STATUS.SUCCESS,
      details: {
        requestId,
        documentCount: apiData?.result?.length || 0,
      },
    });

    res.json({
      success: true,
      message: "Successfully refreshed documents from LHDN",
      count: apiData?.result?.length || 0,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error refreshing documents from LHDN API:", error);

    // Log error
    await LoggingService.log({
      description: "Error refreshing documents from LHDN",
      username: req?.session?.user?.username || "System",
      userId: req?.session?.user?.id,
      ipAddress: req?.ip,
      logType: LOG_TYPES.ERROR,
      module: MODULES.API,
      action: ACTIONS.READ,
      status: STATUS.ERROR,
      details: { error: error.message },
    });

    res.status(500).json({
      success: false,
      error: {
        message: `Failed to refresh documents: ${error.message}`,
        code: error.code || "UNKNOWN_ERROR",
      },
    });
  }
});

// Test endpoint to verify server and LHDN config
router.get("/test/config", async (req, res) => {
  try {
    const lhdnConfig = await getLHDNConfig();
    res.json({
      success: true,
      message: "LHDN configuration is working",
      config: {
        baseUrl: lhdnConfig.baseUrl,
        timeout: lhdnConfig.timeout,
        environment: lhdnConfig.environment || "unknown"
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "LHDN configuration error",
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/** Parse JSON safely for inbound DB columns */
function safeJsonParseInboundColumn(str) {
  if (!str || typeof str !== "string") return null;
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}

/** Supplier / buyer SST registration for inbound list rows and CSV export */
function extractInboundSstFromRow(doc) {
  let issuer =
    doc.issuerTaxRegNo ||
    doc.supplierSstNo ||
    doc.supplierSST ||
    doc.SupplierSST ||
    "";
  let receiver =
    doc.receiverTaxRegNo ||
    doc.receiverSstNo ||
    doc.buyerSstNo ||
    doc.BuyerSST ||
    "";

  if (doc.documentDetails) {
    const parsed = safeJsonParseInboundColumn(doc.documentDetails);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const di = parsed.documentInfo || parsed;
      if (!issuer) {
        issuer =
          parsed.supplierSstNo ||
          di.supplierSstNo ||
          parsed.supplierInfo?.taxRegNo ||
          di.supplierInfo?.taxRegNo ||
          "";
      }
      if (!receiver) {
        receiver =
          parsed.receiverSstNo ||
          di.receiverSstNo ||
          parsed.customerInfo?.taxRegNo ||
          di.customerInfo?.taxRegNo ||
          "";
      }
    }
  }

  return {
    issuerTaxRegNo: issuer ? String(issuer) : null,
    receiverTaxRegNo: receiver ? String(receiver) : null,
  };
}

/**
 * When LHDN /raw or /details returns 404 (e.g. env mismatch, retention, or API drift),
 * still allow View if we have a row in WP_INBOUND_STATUS.
 */
function buildDetailsDataFromInboundRow(row) {
  const parsed = row.documentDetails
    ? safeJsonParseInboundColumn(row.documentDetails)
    : null;
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    return parsed;
  }
  return {
    status: row.status,
    submissionUid: row.submissionUid,
    longId: row.longId,
    internalId: row.internalId,
    typeName: row.typeName,
    typeVersionName: row.typeVersionName,
    issuerTin: row.issuerTin,
    issuerName: row.issuerName,
    receiverTin: row.receiverId,
    receiverName: row.receiverName,
    dateTimeIssued: row.dateTimeIssued,
    dateTimeReceived: row.dateTimeReceived,
    dateTimeValidated: row.dateTimeValidated,
    documentStatusReason: row.documentStatusReason,
    totalSales: row.totalSales != null ? Number(row.totalSales) : 0,
    totalExcludingTax:
      row.totalExcludingTax != null ? Number(row.totalExcludingTax) : 0,
    totalPayableAmount:
      row.totalPayableAmount != null ? Number(row.totalPayableAmount) : 0,
    totalDiscount: row.totalDiscount != null ? Number(row.totalDiscount) : 0,
    totalNetAmount: row.totalNetAmount != null ? Number(row.totalNetAmount) : 0,
  };
}

function buildDocumentDataFromInboundRow(row) {
  if (row.document && typeof row.document === "string" && row.document.trim()) {
    return { document: row.document };
  }
  return { document: null };
}

// Enhanced display-details endpoint with intelligent caching
router.get("/documents/:uuid/display-details", async (req, res) => {
  const lhdnConfig = await getLHDNConfig();
  const { uuid } = req.params;
  const userId = req.session?.user?.id;
  const forceRefresh = req.query.force === "true";

  try {

    // Log the request details
    console.log("Fetching details for document:", {
      uuid,
      user: req.session.user,
      timestamp: new Date().toISOString(),
      forceRefresh,
      cacheEnabled: !forceRefresh,
    });

    // Check if user is logged in
    console.log("=== SESSION DEBUG ===");
    console.log("Request headers:", req.headers);
    console.log("Session ID:", req.sessionID);
    console.log("Session exists:", !!req.session);
    console.log("Session user:", req.session?.user);
    console.log("Session accessToken:", req.session?.accessToken ? "EXISTS" : "MISSING");
    console.log("Session cookie:", req.session?.cookie);
    console.log("===================");
    
    if (!req.session.user || !req.session.accessToken) {
      console.log("Authentication failed - missing user or accessToken");
      return res.status(401).json({
        success: false,
        message: "Authentication required. Please log in again.",
        error: "AUTHENTICATION_REQUIRED",
      });
    }

    // Check cache first (unless force refresh is requested)
    if (!forceRefresh) {
      const cachedRawData = lhdnCache.get("document-raw", uuid, userId);
      const cachedDetailsData = lhdnCache.get("document-details", uuid, userId);

      if (cachedRawData && cachedDetailsData) {
        console.log(`[Cache] Using cached data for document ${uuid}`);

        // Process cached data and return
        const processedData = await processDocumentData(
          cachedRawData,
          cachedDetailsData,
          uuid
        );
        return res.json({
          success: true,
          documentInfo: processedData,
          supplierInfo: processedData.supplierInfo,
          customerInfo: processedData.customerInfo,
          paymentInfo: processedData.paymentInfo,
          cached: true,
          cacheAge: Date.now() - (cachedRawData.timestamp || 0),
        });
      }
    }

    // Fetch fresh data from LHDN API
    console.log("Fetching fresh data from LHDN API...");

    // Get raw document with correct headers per LHDN SDK
    console.log("Fetching raw document from LHDN API...");
    const rawResponse = await axios.get(
      `${lhdnConfig.baseUrl}/api/v1.0/documents/${uuid}/raw`,
      {
        headers: {
          Authorization: `Bearer ${req.session.accessToken}`,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        timeout: 30000,
      }
    );

    const documentData = rawResponse.data;
    console.log("Raw document data received");

    // Get document details with correct headers per LHDN SDK
    const detailsResponse = await axios.get(
      `${lhdnConfig.baseUrl}/api/v1.0/documents/${uuid}/details`,
      {
        headers: {
          Authorization: `Bearer ${req.session.accessToken}`,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        timeout: 30000,
      }
    );

    const detailsData = detailsResponse.data;
    console.log("Document details received");

    // Cache the fresh data
    lhdnCache.set("document-raw", uuid, documentData, userId);
    lhdnCache.set("document-details", uuid, detailsData, userId);
    console.log(`[Cache] Stored fresh data for document ${uuid}`);

    // Update status in WP_INBOUND_STATUS when viewing details
    try {
      const currentTime = new Date().toISOString();

      // Check if document exists in our database
      const existingDoc = await prisma.wP_INBOUND_STATUS.findUnique({
        where: { uuid },
        select: {
          status: true,
          dateTimeValidated: true,
          documentStatusReason: true,
          updated_at: true
        }
      });

      if (existingDoc) {
        // Update the document with latest status from LHDN API
        const updateData = {
          updated_at: currentTime
        };

        // If we have fresh status information from the details API, update it
        if (detailsData.status && detailsData.status !== existingDoc.status) {
          updateData.status = detailsData.status;
          updateData.documentStatusReason = detailsData.documentStatusReason || null;

          console.log(`📊 Status updated on view details for ${uuid}: ${existingDoc.status} → ${detailsData.status}`);

          // Log status change for monitoring
          await LoggingService.log({
            description: `Document status updated on view details: ${existingDoc.status} → ${detailsData.status}`,
            username: req?.session?.user?.username || "System",
            userId: req?.session?.user?.id,
            ipAddress: req?.ip,
            logType: LOG_TYPES.INFO,
            module: MODULES.API,
            action: ACTIONS.UPDATE,
            status: STATUS.SUCCESS,
            details: {
              uuid: uuid,
              oldStatus: existingDoc.status,
              newStatus: detailsData.status,
              viewedBy: req?.session?.user?.username || "System",
              timestamp: currentTime
            }
          });
        }

        // Update the record
        await prisma.wP_INBOUND_STATUS.update({
          where: { uuid },
          data: updateData
        });

        console.log(`✅ Updated WP_INBOUND_STATUS for document ${uuid} on view details`);
      } else {
        console.log(`⚠️ Document ${uuid} not found in WP_INBOUND_STATUS table`);
      }
    } catch (statusUpdateError) {
      console.error(`❌ Error updating status for document ${uuid}:`, statusUpdateError);
      // Continue processing even if status update fails
    }

    // Process the data
    const processedData = await processDocumentData(
      documentData,
      detailsData,
      uuid
    );

    return res.json({
      success: true,
      documentInfo: processedData,
      supplierInfo: processedData.supplierInfo,
      customerInfo: processedData.customerInfo,
      paymentInfo: processedData.paymentInfo,
      cached: false,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error fetching document details:", error);

    // Enhanced error logging for debugging
    if (error.response) {
      console.error("LHDN API Error Response:", {
        status: error.response.status,
        statusText: error.response.statusText,
        headers: error.response.headers,
        data:
          typeof error.response.data === "string"
            ? error.response.data.substring(0, 500) + "..."
            : error.response.data,
      });
    }

    // Fallback to cache on error
    if (!req.query.force) {
      const cachedRawData = lhdnCache.get("document-raw", uuid, userId);
      const cachedDetailsData = lhdnCache.get("document-details", uuid, userId);

      if (cachedRawData && cachedDetailsData) {
        console.log(
          `[Cache] Using cached data as fallback for document ${uuid}`
        );
        const processedData = await processDocumentData(
          cachedRawData,
          cachedDetailsData,
          uuid
        );
        return res.json({
          success: true,
          documentInfo: processedData,
          supplierInfo: processedData.supplierInfo,
          customerInfo: processedData.customerInfo,
          paymentInfo: processedData.paymentInfo,
          cached: true,
          fallback: true,
          warning: "Using cached data due to API error",
        });
      }
    }

    // LHDN 404: row may exist locally even when /raw or /details no longer resolve
    if (error.response?.status === 404) {
      try {
        const row = await prisma.wP_INBOUND_STATUS.findUnique({
          where: { uuid },
        });
        if (row) {
          const detailsData = buildDetailsDataFromInboundRow(row);
          const documentData = buildDocumentDataFromInboundRow(row);
          const processedData = await processDocumentData(
            documentData,
            detailsData,
            uuid
          );
          if (row.validationResults) {
            try {
              processedData.validationResults = JSON.parse(
                row.validationResults
              );
            } catch {
              /* keep without parsed validation */
            }
          }
          console.log(
            `[Inbound View] LHDN 404 for ${uuid}; returning WP_INBOUND_STATUS fallback`
          );
          return res.json({
            success: true,
            documentInfo: processedData,
            supplierInfo: processedData.supplierInfo,
            customerInfo: processedData.customerInfo,
            paymentInfo: processedData.paymentInfo,
            cached: false,
            fallback: true,
            source: "database",
            warning:
              "LHDN did not return this document (404). Showing last data stored locally.",
          });
        }
      } catch (dbFallbackErr) {
        console.error(
          `[Inbound View] DB fallback after LHDN 404 failed for ${uuid}:`,
          dbFallbackErr.message
        );
      }
    }

    // Determine error type and provide appropriate message
    let errorMessage = "Failed to fetch document details";
    let statusCode = 500;

    if (error.response) {
      statusCode = error.response.status;
      if (error.response.status === 401) {
        errorMessage = "Authentication failed. Please login again.";
      } else if (error.response.status === 403) {
        errorMessage =
          "Access denied. You don't have permission to view this document.";
      } else if (error.response.status === 404) {
        errorMessage = "Document not found in LHDN system.";
      } else if (error.response.status === 429) {
        errorMessage = "Rate limit exceeded. Please try again later.";
      } else if (
        error.response.data &&
        typeof error.response.data === "string" &&
        error.response.data.includes("<!DOCTYPE")
      ) {
        errorMessage =
          "LHDN API returned HTML instead of JSON. Check API endpoint and headers.";
      }
    } else if (error.code === "ECONNREFUSED") {
      errorMessage =
        "Cannot connect to LHDN API. Please check your connection.";
      statusCode = 503;
    }

    return res.status(statusCode).json({
      success: false,
      message: errorMessage,
      error: error.message,
      details: error.response
        ? {
            status: error.response.status,
            statusText: error.response.statusText,
          }
        : null,
    });
  }
});

// Helper function to process document data
async function processDocumentData(documentData, detailsData, uuid) {
  try {
    // Safe JSON parser
    function safeJsonParse(str) {
      if (!str || typeof str !== "string") return null;
      try {
        return JSON.parse(str);
      } catch (e) {
        console.error("JSON parse error:", e);
        return null;
      }
    }

    // Extract document content
    let parsedDocument = null;
    if (documentData?.document) {
      parsedDocument = safeJsonParse(documentData.document);
    }

    // Extract party identification with enhanced error handling
    function getPartyIdentification(partyIdentification) {
      const idTypes = ["TIN", "BRN", "NRIC", "Passport", "Army", "SST", "TTX"];
      const result = {
        tin: null,
        registrationNo: null,
        taxRegNo: null,
        idType: "N/A",
        idNumber: "N/A",
      };

      if (!partyIdentification || !Array.isArray(partyIdentification)) {
        return result;
      }

      try {
        // Get TIN
        const tinInfo = partyIdentification.find(
          (id) => id.ID?.[0]?.schemeID === "TIN"
        );
        if (tinInfo && tinInfo.ID?.[0]?._) {
          result.tin = tinInfo.ID[0]._;
        }

        // Get Registration Number (try BRN first, then other types)
        const brnInfo = partyIdentification.find(
          (id) => id.ID?.[0]?.schemeID === "BRN"
        );
        if (brnInfo && brnInfo.ID?.[0]?._) {
          result.registrationNo = brnInfo.ID[0]._;
          result.idType = "BRN";
          result.idNumber = brnInfo.ID[0]._;
        } else {
          // Try other ID types in order
          for (const idType of idTypes) {
            if (["TIN", "SST"].includes(idType)) continue;
            const idInfo = partyIdentification.find(
              (id) => id.ID?.[0]?.schemeID === idType
            );
            if (idInfo && idInfo.ID?.[0]?._) {
              result.registrationNo = idInfo.ID[0]._;
              result.idType = idType;
              result.idNumber = idInfo.ID[0]._;
              break;
            }
          }
        }

        // Get Tax Registration Number (SST)
        const sstInfo = partyIdentification.find(
          (id) => id.ID?.[0]?.schemeID === "SST"
        );
        if (sstInfo && sstInfo.ID?.[0]?._) {
          result.taxRegNo = sstInfo.ID[0]._;
        }

        // If no registration number found, try TTX
        if (!result.registrationNo) {
          const ttxInfo = partyIdentification.find(
            (id) => id.ID?.[0]?.schemeID === "TTX"
          );
          if (ttxInfo && ttxInfo.ID?.[0]?._) {
            result.registrationNo = ttxInfo.ID[0]._;
            result.idType = "TTX";
            result.idNumber = ttxInfo.ID[0]._;
          }
        }
      } catch (error) {
        console.warn("Error extracting party identification:", error);
      }

      return result;
    }

    // Helper function to get basic info when parsing fails
    function getBasicInfo() {
      return {
        uuid: uuid,
        document:
          typeof documentData?.document === "string" ? documentData.document : null,
        status: detailsData.status || "Unknown",
        submissionUid: detailsData.submissionUid || "N/A",
        longId: detailsData.longId || "N/A",
        internalId: detailsData.internalId || "N/A",
        typeName: detailsData.typeName || "Unknown",
        typeVersionName: detailsData.typeVersionName || "Unknown",
        issuerTin: detailsData.issuerTin || "N/A",
        issuerName: detailsData.issuerName || "N/A",
        receiverTin: detailsData.receiverTin || "N/A",
        receiverName: detailsData.receiverName || "N/A",
        dateTimeIssued: detailsData.dateTimeIssued || "N/A",
        dateTimeReceived: detailsData.dateTimeReceived || "N/A",
        dateTimeValidated: detailsData.dateTimeValidated || "N/A",
        totalSales: detailsData.totalSales || 0,
        totalPayableAmount: detailsData.totalPayableAmount || 0,
        totalExcludingTax: detailsData.totalExcludingTax || 0,
        taxAmount:
          (detailsData.totalSales || 0) - (detailsData.totalExcludingTax || 0),
        irbmUniqueNo: uuid,
        irbmlongId: detailsData.longId || "N/A",

        // Basic supplier info from detailsData
        supplierInfo: {
          company: detailsData.issuerName || "N/A",
          tin: detailsData.issuerTin || null,
          registrationNo: null,
          taxRegNo: null,
          idType: "N/A",
          idNumber: "N/A",
          msicCode: null,
          address: null,
        },

        // Basic customer info from detailsData
        customerInfo: {
          company: detailsData.receiverName || "N/A",
          tin: detailsData.receiverTin || null,
          registrationNo: null,
          taxRegNo: null,
          idType: "N/A",
          idNumber: "N/A",
          address: null,
        },

        // Basic payment info
        paymentInfo: {
          totalIncludingTax: detailsData.totalSales || 0,
          totalExcludingTax: detailsData.totalExcludingTax || 0,
          taxAmount:
            (detailsData.totalSales || 0) -
            (detailsData.totalExcludingTax || 0),
          totalPayableAmount: detailsData.totalPayableAmount || 0,
          irbmUniqueNo: uuid,
          irbmlongId: detailsData.longId || "N/A",
        },

        lineItems: [],
      };
    }

    if (!parsedDocument || !parsedDocument.Invoice) {
      console.log(
        "Could not parse document or missing Invoice, returning basic info"
      );
      console.log("parsedDocument:", parsedDocument ? "exists" : "null");
      console.log(
        "parsedDocument.Invoice:",
        parsedDocument?.Invoice ? "exists" : "missing"
      );
      if (parsedDocument) {
        console.log("parsedDocument keys:", Object.keys(parsedDocument));
      }
      return getBasicInfo();
    }

    const invoice = parsedDocument.Invoice[0]; // Invoice is an array
    const supplierParty = invoice.AccountingSupplierParty?.[0]?.Party?.[0];
    const customerParty = invoice.AccountingCustomerParty?.[0]?.Party?.[0];

    const supplierIdentification = getPartyIdentification(
      supplierParty?.PartyIdentification
    );
    const customerIdentification = getPartyIdentification(
      customerParty?.PartyIdentification
    );

    // Extract line items
    const lineItems = (invoice.InvoiceLine || []).map((line, index) => {
      const item = line.Item?.[0];
      const price = line.Price?.[0];
      const quantity = parseFloat(line.InvoicedQuantity?.[0]?._ || 0);
      const unitPrice = parseFloat(price?.PriceAmount?.[0]?._ || 0);
      const lineExtensionAmount = parseFloat(
        line.LineExtensionAmount?.[0]?._ || 0
      );
      const allowanceCharges = parseFloat(
        line.AllowanceCharge?.[0]?.Amount?.[0]?._ || 0
      );
      const unitCode = line.InvoicedQuantity?.[0]?.unitCode || "XNA";

      return {
        lineNo: index + 1,
        description: item?.Description?.[0] || "N/A",
        quantity,
        unitPrice,
        unitCode,
        subtotal: lineExtensionAmount,
        allowanceCharges,
        total: lineExtensionAmount - allowanceCharges,
      };
    });

    // Enrich with cancellation details from DB
    let cancelEnrichment = {
      cancelDateTime: null,
      documentStatusReason: null,
      cancelledByUsername: null,
    };

    try {
      const inboundRecord = await prisma.wP_INBOUND_STATUS.findUnique({
        where: { uuid: documentData.uuid || uuid },
      });

      if (inboundRecord) {
        cancelEnrichment.cancelDateTime = inboundRecord.cancelDateTime || null;
        cancelEnrichment.documentStatusReason =
          inboundRecord.documentStatusReason || null;

        if (inboundRecord.createdByUserId) {
          const byId = await prisma.wP_USER_REGISTRATION.findFirst({
            where: { ID: Number(inboundRecord.createdByUserId) || -1 },
          });
          const byUsername = !byId
            ? await prisma.wP_USER_REGISTRATION.findFirst({
                where: { Username: String(inboundRecord.createdByUserId) },
              })
            : null;

          cancelEnrichment.cancelledByUsername =
            byId?.Username ||
            byUsername?.Username ||
            inboundRecord.createdByUserId ||
            null;
        }
      }
    } catch (dbError) {
      console.warn(
        "Failed to fetch cancellation details from DB:",
        dbError.message
      );
    }

    // Process validation results if available
    let validationResults = null;
    if (detailsData.validationResults) {
      validationResults = {
        status: detailsData.status,
        validationSteps: detailsData.validationResults.validationSteps?.map(step => {
          let errors = [];
          if (step.error) {
            if (Array.isArray(step.error.errors)) {
              errors = step.error.errors.map(err => ({
                code: err.code || 'VALIDATION_ERROR',
                message: err.message || err.toString(),
                field: err.field || null,
                value: err.value || null,
                details: err.details || null
              }));
            } else if (typeof step.error === 'object') {
              errors = [{
                code: step.error.code || 'VALIDATION_ERROR',
                message: step.error.message || step.error.toString(),
                field: step.error.field || null,
                value: step.error.value || null,
                details: step.error.details || null
              }];
            } else {
              errors = [{
                code: 'VALIDATION_ERROR',
                message: step.error.toString(),
                field: null,
                value: null,
                details: null
              }];
            }
          }

          return {
            name: step.name || 'Validation Step',
            status: step.status || 'Invalid',
            error: errors.length > 0 ? { errors } : null,
            timestamp: step.timestamp || new Date().toISOString()
          };
        }) || [],
        summary: {
          totalSteps: detailsData.validationResults.validationSteps?.length || 0,
          failedSteps: detailsData.validationResults.validationSteps?.filter(step => step.status === 'Invalid' || step.error)?.length || 0,
          lastUpdated: new Date().toISOString()
        }
      };
    }

    // Final structured response
    return {
      uuid: documentData.uuid || uuid,
      // Preserve UBL JSON string for PDF generation (POST /documents/:uuid/pdf)
      document:
        typeof documentData.document === "string" ? documentData.document : null,
      submissionUid: detailsData.submissionUid || "N/A",
      longId: detailsData.longId || "N/A",
      irbmlongId: detailsData.longId || "N/A",
      internalId: detailsData.internalId || "N/A",
      status: detailsData.status || "Unknown",
      validationResults: validationResults,
      dateTimeIssued:
        detailsData.dateTimeIssued || invoice.IssueDate?.[0] || "N/A",
      dateTimeReceived: detailsData.dateTimeReceived || "N/A",
      dateTimeValidated: detailsData.dateTimeValidated || "N/A",
      totalSales:
        detailsData.totalSales ||
        parseFloat(
          invoice.LegalMonetaryTotal?.[0]?.TaxInclusiveAmount?.[0]?._ || 0
        ),
      totalPayableAmount:
        detailsData.totalPayableAmount ||
        parseFloat(invoice.LegalMonetaryTotal?.[0]?.PayableAmount?.[0]?._ || 0),
      totalExcludingTax:
        detailsData.totalExcludingTax ||
        parseFloat(
          invoice.LegalMonetaryTotal?.[0]?.TaxExclusiveAmount?.[0]?._ || 0
        ),
      taxAmount: parseFloat(invoice.TaxTotal?.[0]?.TaxAmount?.[0]?._ || 0),
      irbmUniqueNo: uuid,
      ...cancelEnrichment,

      // Party info
      supplierName:
        detailsData.issuerName ||
        supplierParty?.PartyName?.[0]?.Name?.[0] ||
        "N/A",
      supplierTIN: supplierIdentification.tin,
      supplierRegistrationNo: supplierIdentification.registrationNo,
      supplierSstNo: supplierIdentification.taxRegNo,
      supplierMsicCode:
        supplierParty?.IndustryClassificationCode?.[0]?._ ||
        documentData.supplierMsicCode ||
        detailsData.supplierMsicCode ||
        null,
      supplierAddress:
        supplierParty?.PostalAddress?.[0]?.AddressLine?.map(
          (line) => line.Line?.[0]?._
        )
          .filter(Boolean)
          .join(", ") ||
        documentData.supplierAddress ||
        detailsData.supplierAddress ||
        null,

      receiverName:
        detailsData.receiverName ||
        customerParty?.PartyName?.[0]?.Name?.[0] ||
        "N/A",
      receiverTIN: customerIdentification.tin,
      receiverRegistrationNo: customerIdentification.registrationNo,
      receiverSstNo: customerIdentification.taxRegNo,
      receiverAddress:
        customerParty?.PostalAddress?.[0]?.AddressLine?.map(
          (line) => line.Line?.[0]?._
        )
          .filter(Boolean)
          .join(", ") ||
        documentData.receiverAddress ||
        detailsData.receiverAddress ||
        null,

      // Detailed breakdowns
      supplierInfo: {
        company:
          supplierParty?.PartyLegalEntity?.[0]?.RegistrationName?.[0]?._ ||
          supplierParty?.PartyName?.[0]?.Name?.[0] ||
          detailsData.issuerName ||
          documentData.supplierName ||
          "N/A",
        tin:
          supplierIdentification.tin ||
          detailsData.issuerTin ||
          documentData.supplierTin ||
          null,
        registrationNo:
          supplierIdentification.registrationNo ||
          documentData.supplierRegistrationNo ||
          null,
        taxRegNo:
          supplierIdentification.taxRegNo || documentData.supplierSstNo || null,
        idType: supplierIdentification.idType || "N/A",
        idNumber:
          supplierIdentification.idNumber ||
          documentData.supplierRegistrationNo ||
          null,
        msicCode:
          supplierParty?.IndustryClassificationCode?.[0]?._ ||
          documentData.supplierMsicCode ||
          detailsData.supplierMsicCode ||
          null,
        address:
          supplierParty?.PostalAddress?.[0]?.AddressLine?.map(
            (line) => line.Line?.[0]?._
          )
            .filter(Boolean)
            .join(", ") ||
          documentData.supplierAddress ||
          detailsData.supplierAddress ||
          null,
      },
      customerInfo: {
        company:
          customerParty?.PartyLegalEntity?.[0]?.RegistrationName?.[0]?._ ||
          customerParty?.PartyName?.[0]?.Name?.[0] ||
          detailsData.receiverName ||
          documentData.receiverName ||
          "N/A",
        tin:
          customerIdentification.tin ||
          detailsData.receiverTin ||
          documentData.receiverTin ||
          null,
        registrationNo:
          customerIdentification.registrationNo ||
          documentData.receiverRegistrationNo ||
          null,
        taxRegNo:
          customerIdentification.taxRegNo || documentData.receiverSstNo || null,
        idType: customerIdentification.idType || "N/A",
        idNumber:
          customerIdentification.idNumber ||
          documentData.receiverRegistrationNo ||
          null,
        address:
          customerParty?.PostalAddress?.[0]?.AddressLine?.map(
            (line) => line.Line?.[0]?._
          )
            .filter(Boolean)
            .join(", ") ||
          documentData.receiverAddress ||
          detailsData.receiverAddress ||
          null,
      },
      paymentInfo: {
        totalIncludingTax: parseFloat(
          invoice.LegalMonetaryTotal?.[0]?.TaxInclusiveAmount?.[0]?._ ||
            detailsData.totalSales ||
            documentData.totalSales ||
            0
        ),
        totalExcludingTax: parseFloat(
          invoice.LegalMonetaryTotal?.[0]?.TaxExclusiveAmount?.[0]?._ ||
            detailsData.totalExcludingTax ||
            documentData.totalExcludingTax ||
            0
        ),
        taxAmount: parseFloat(
          invoice.TaxTotal?.[0]?.TaxAmount?.[0]?._ ||
            detailsData.totalSales - detailsData.totalExcludingTax ||
            documentData.totalSales - documentData.totalExcludingTax ||
            0
        ),
        totalPayableAmount: parseFloat(
          invoice.LegalMonetaryTotal?.[0]?.PayableAmount?.[0]?._ ||
            detailsData.totalPayableAmount ||
            documentData.totalPayableAmount ||
            0
        ),
        irbmUniqueNo: uuid,
        irbmlongId: detailsData.longId || "N/A",
      },
      lineItems,
    };
  } catch (error) {
    console.error("Error processing document data:", error);
    // Return basic info on processing failure
    return {
      uuid: uuid,
      status: detailsData?.status || "Unknown",
      error: "Failed to process document data",
      message: error.message,
      lineItems: [],
      supplierInfo: {},
      customerInfo: {},
    };
  }
}
// // Enhanced display-details endpoint with intelligent caching
// router.get("/documents/:uuid/display-details", async (req, res) => {
//   const lhdnConfig = await getLHDNConfig();

//   try {
//     const { uuid } = req.params;
//     const userId = req.session?.user?.id;
//     const forceRefresh = req.query.force === 'true';

//     // Log the request details
//     console.log("Fetching details for document:", {
//       uuid,
//       user: req.session.user,
//       timestamp: new Date().toISOString(),
//       forceRefresh,
//       cacheEnabled: !forceRefresh
//     });

//     // Check if user is logged in
//     if (!req.session.user || !req.session.accessToken) {
//       return res.redirect("/login");
//     }

//     // Check cache first (unless force refresh is requested)
//     if (!forceRefresh) {
//       const cachedRawData = lhdnCache.get('document-raw', uuid, userId);
//       const cachedDetailsData = lhdnCache.get('document-details', uuid, userId);

//       if (cachedRawData && cachedDetailsData) {
//         console.log(`[Cache] Using cached data for document ${uuid}`);

//         // Process cached data and return
//         const processedData = await processDocumentData(cachedRawData, cachedDetailsData, uuid);
//         return res.json({
//           success: true,
//           documentInfo: processedData,
//           cached: true,
//           cacheAge: Date.now() - (cachedRawData.timestamp || 0)
//         });
//       }
//     }

//     // Fetch fresh data from LHDN API
//     console.log("Fetching fresh data from LHDN API...");

//     // Get document details directly from LHDN API using raw endpoint
//     console.log("Fetching raw document from LHDN API...");
//     const response = await axios.get(
//       `${lhdnConfig.baseUrl}/api/v1.0/documents/${uuid}/raw`,
//       {
//         headers: {
//           Authorization: `Bearer ${req.session.accessToken}`,
//           "Content-Type": "application/json",
//         },
//         timeout: 30000, // 30 second timeout
//       }
//     );

//     const documentData = response.data;
//     console.log("Raw document data received");

//     // Get document details from LHDN API
//     const detailsResponse = await axios.get(
//       `${lhdnConfig.baseUrl}/api/v1.0/documents/${uuid}/details`,
//       {
//         headers: {
//           Authorization: `Bearer ${req.session.accessToken}`,
//           "Content-Type": "application/json",
//         },
//         timeout: 30000, // 30 second timeout
//       }
//     );

//     const detailsData = detailsResponse.data;
//     console.log("Document details received");

//     // Cache the fresh data
//     lhdnCache.set('document-raw', uuid, documentData, userId);
//     lhdnCache.set('document-details', uuid, detailsData, userId);
//     console.log(`[Cache] Stored fresh data for document ${uuid}`);

//     // Process the data
//     const processedData = await processDocumentData(documentData, detailsData, uuid);

//     return res.json({
//       success: true,
//       documentInfo: processedData,
//       cached: false,
//       timestamp: new Date().toISOString()
//     });

//   } catch (error) {
//     console.error("Error fetching document details:", error);

//     // If there's an error, try to return cached data as fallback
//     if (!req.query.force) {
//       const cachedRawData = lhdnCache.get('document-raw', uuid, userId);
//       const cachedDetailsData = lhdnCache.get('document-details', uuid, userId);

//       if (cachedRawData && cachedDetailsData) {
//         console.log(`[Cache] Using cached data as fallback for document ${uuid}`);
//         const processedData = await processDocumentData(cachedRawData, cachedDetailsData, uuid);
//         return res.json({
//           success: true,
//           documentInfo: processedData,
//           cached: true,
//           fallback: true,
//           warning: "Using cached data due to API error"
//         });
//       }
//     }

//     return res.status(500).json({
//       success: false,
//       message: "Failed to fetch document details",
//       error: error.message,
//     });
//   }
// });

// // Helper function to process document data (extracted for reuse)
// async function processDocumentData(documentData, detailsData, uuid) {
//   try {
//     // Helper function to safely parse JSON
//     function safeJsonParse(jsonString) {
//       if (!jsonString || typeof jsonString !== "string") {
//         return null;
//       }
//       try {
//         return JSON.parse(jsonString);
//       } catch (e) {
//         console.error("JSON parse error:", e);
//         return null;
//       }
//     }

//     // Helper function to get basic document info
//     function getBasicDocumentInfo() {
//       return {
//         success: true,
//         documentInfo: {
//           uuid: uuid,
//           status: detailsData.status || "Unknown",
//           submissionUid: detailsData.submissionUid || "N/A",
//           longId: detailsData.longId || "N/A",
//           internalId: detailsData.internalId || "N/A",
//           typeName: detailsData.typeName || "Unknown",
//           typeVersionName: detailsData.typeVersionName || "Unknown",
//           issuerTin: detailsData.issuerTin || "N/A",
//           issuerName: detailsData.issuerName || "N/A",
//           receiverTin: detailsData.receiverTin || "N/A",
//           receiverName: detailsData.receiverName || "N/A",
//           dateTimeIssued: detailsData.dateTimeIssued || "N/A",
//           dateTimeReceived: detailsData.dateTimeReceived || "N/A",
//           dateTimeValidated: detailsData.dateTimeValidated || "N/A",
//           totalSales: detailsData.totalSales || 0,
//           totalPayableAmount: detailsData.totalPayableAmount || 0,
//           totalExcludingTax: detailsData.totalExcludingTax || 0,
//           taxAmount: detailsData.totalSales - (detailsData.totalExcludingTax || 0),
//           irbmUniqueNo: uuid,
//           irbmlongId: detailsData.longId || "N/A",
//         },
//       };
//     }

//     // Helper function to get ID information
//     function getPartyIdentification(partyIdentification) {
//       const idTypes = ["TIN", "BRN", "NRIC", "Passport", "Army", "SST"];
//       const result = {
//         tin: null,
//         registrationNo: null,
//         taxRegNo: null,
//         idType: "NA",
//         idNumber: "NA",
//       };

//       if (!partyIdentification) return result;

//       // Get TIN
//       const tinInfo = partyIdentification.find(
//         (id) => id.ID[0].schemeID === "TIN"
//       );
//       if (tinInfo) {
//         result.tin = tinInfo.ID[0]._;
//       }

//       // Get Registration Number (try BRN first, then other types)
//       const brnInfo = partyIdentification.find(
//         (id) => id.ID[0].schemeID === "BRN"
//       );
//       if (brnInfo) {
//         result.registrationNo = brnInfo.ID[0]._;
//         result.idType = "BRN";
//         result.idNumber = brnInfo.ID[0]._;
//       } else {
//         // Try other ID types in order
//         for (const idType of idTypes) {
//           if (idType === "TIN" || idType === "SST") continue;
//           const idInfo = partyIdentification.find(
//             (id) => id.ID[0].schemeID === idType
//           );
//           if (idInfo) {
//             result.registrationNo = idInfo.ID[0]._;
//             result.idType = idType;
//             result.idNumber = idInfo.ID[0]._;
//             break;
//           }
//         }
//       }

//       // Get Tax Registration Number (SST)
//       const sstInfo = partyIdentification.find(
//         (id) => id.ID[0].schemeID === "SST"
//       );
//       if (sstInfo) {
//         result.taxRegNo = sstInfo.ID[0]._;
//       }

//       return result;
//     }

//     // Process validation results
//     // This section processes validation results but doesn't use them
//     // Keeping the code for future reference
//     if (detailsData.validationResults) {
//       /* Commented out unused code
//             const processedResults = {
//                 status: detailsData.status,
//                 validationSteps: detailsData.validationResults.validationSteps?.map(step => {
//                     let errors = [];
//                     if (step.error) {
//                         if (Array.isArray(step.error.errors)) {
//                             errors = step.error.errors.map(err => ({
//                                 code: err.code || 'VALIDATION_ERROR',
//                                 message: err.message || err.toString(),
//                                 field: err.field || null,
//                                 value: err.value || null,
//                                 details: err.details || null
//                             }));
//                         } else if (typeof step.error === 'object') {
//                             errors = [{
//                                 code: step.error.code || 'VALIDATION_ERROR',
//                                 message: step.error.message || step.error.toString(),
//                                 field: step.error.field || null,
//                                 value: step.error.value || null,
//                                 details: step.error.details || null
//                             }];
//                         } else {
//                             errors = [{
//                                 code: 'VALIDATION_ERROR',
//                                 message: step.error.toString(),
//                                 field: null,
//                                 value: null,
//                                 details: null
//                             }];
//                         }
//                     }

//                     return {
//                         name: step.name || 'Validation Step',
//                         status: step.status || 'Invalid',
//                         error: errors.length > 0 ? { errors } : null,
//                         timestamp: step.timestamp || new Date().toISOString()
//                     };
//                 }) || [],
//                 summary: {
//                     totalSteps: detailsData.validationResults.validationSteps?.length || 0,
//                     failedSteps: detailsData.validationResults.validationSteps?.filter(step => step.status === 'Invalid' || step.error)?.length || 0,
//                     lastUpdated: new Date().toISOString()
//                 }
//             };
//             */
//     }

//     // Try to parse the document content
//     let parsedDocument = null;
//     if (documentData && documentData.document) {
//       parsedDocument = safeJsonParse(documentData.document);
//     }

//     if (!parsedDocument) {
//       console.log("Could not parse document, returning basic info");
//       return getBasicDocumentInfo();
//     }

//     // Extract invoice data
//     const invoice = parsedDocument.Invoice;
//     if (!invoice) {
//       console.log("No invoice data found, returning basic info");
//       return getBasicDocumentInfo();
//     }

//     // Extract supplier and customer information
//     const supplierParty = invoice.AccountingSupplierParty?.[0]?.Party?.[0];
//     const customerParty = invoice.AccountingCustomerParty?.[0]?.Party?.[0];

//     const supplierInfo = getPartyIdentification(
//       supplierParty?.PartyIdentification
//     );
//     const customerInfo = getPartyIdentification(
//       customerParty?.PartyIdentification
//     );

//     // Extract line items
//     const invoiceLines = invoice.InvoiceLine || [];
//     const lineItems = invoiceLines.map((line, index) => {
//       const item = line.Item?.[0];
//       const price = line.Price?.[0];
//       const quantity = parseFloat(line.InvoicedQuantity?.[0]._ || 0);
//       const unitPrice = parseFloat(price?.PriceAmount?.[0]._ || 0);
//       const lineExtensionAmount = parseFloat(
//         line.LineExtensionAmount?.[0]._ || 0
//       );
//       const allowanceCharges = parseFloat(
//         line.AllowanceCharge?.[0]?.Amount?.[0]._ || 0
//       );
//       const unitCode = line.InvoicedQuantity?.[0]?.unitCode || "NA";

//       return {
//         lineNo: index + 1,
//         description: item?.Description?.[0] || "N/A",
//         quantity: quantity,
//         unitPrice: unitPrice,
//         unitCode: unitCode,
//         subtotal: lineExtensionAmount,
//         allowanceCharges: allowanceCharges,
//         total: lineExtensionAmount - allowanceCharges,
//       };
//     });

//     // Return processed document information
//     return {
//       uuid: uuid,
//       status: detailsData.status || "Unknown",
//       submissionUid: detailsData.submissionUid || "N/A",
//       longId: detailsData.longId || "N/A",
//       internalId: detailsData.internalId || "N/A",
//       typeName: detailsData.typeName || "Unknown",
//       typeVersionName: detailsData.typeVersionName || "Unknown",
//       issuerTin: detailsData.issuerTin || supplierInfo.tin || "N/A",
//       issuerName: detailsData.issuerName ||
//         supplierParty?.PartyName?.[0]?.Name?.[0] || "N/A",
//       receiverTin: detailsData.receiverTin || customerInfo.tin || "N/A",
//       receiverName: detailsData.receiverName ||
//         customerParty?.PartyName?.[0]?.Name?.[0] || "N/A",
//       dateTimeIssued: detailsData.dateTimeIssued ||
//         invoice.IssueDate?.[0] || "N/A",
//       dateTimeReceived: detailsData.dateTimeReceived || "N/A",
//       dateTimeValidated: detailsData.dateTimeValidated || "N/A",
//       totalSales: detailsData.totalSales ||
//         parseFloat(invoice.LegalMonetaryTotal?.[0]?.TaxInclusiveAmount?.[0]._ || 0),
//       totalPayableAmount: detailsData.totalPayableAmount ||
//         parseFloat(invoice.LegalMonetaryTotal?.[0]?.PayableAmount?.[0]._ || 0),
//       totalExcludingTax: detailsData.totalExcludingTax ||
//         parseFloat(invoice.LegalMonetaryTotal?.[0]?.TaxExclusiveAmount?.[0]._ || 0),
//       taxAmount: parseFloat(invoice.TaxTotal?.[0]?.TaxAmount?.[0]._ || 0),
//       irbmUniqueNo: uuid,
//       irbmlongId: detailsData.longId || "N/A",
//       lineItems: lineItems,
//       supplierInfo: supplierInfo,
//       customerInfo: customerInfo,
//     };

//   } catch (error) {
//     console.error("Error processing document data:", error);
//     // Return basic info on error
//     return {
//       uuid: uuid,
//       status: detailsData?.status || "Unknown",
//       error: "Failed to process document data",
//       message: error.message
//     };
//   }
// }
//       const supplierParty = invoice.AccountingSupplierParty[0].Party[0];
//       const customerParty = invoice.AccountingCustomerParty[0].Party[0];

//       // Get identification info for both parties
//       const supplierIdentification = getPartyIdentification(
//         supplierParty.PartyIdentification
//       );
//       const customerIdentification = getPartyIdentification(
//         customerParty.PartyIdentification
//       );

//       // Enrich with cancellation details from DB for parsed branch
//       let cancelEnrichment = {
//         cancelDateTime: null,
//         documentStatusReason: null,
//         cancelledByUsername: null,
//       };
//       try {
//         const inboundRecord = await prisma.wP_INBOUND_STATUS.findUnique({
//           where: { uuid: documentData.uuid },
//         });
//         if (inboundRecord) {
//           cancelEnrichment.cancelDateTime =
//             inboundRecord.cancelDateTime || null;
//           cancelEnrichment.documentStatusReason =
//             inboundRecord.documentStatusReason || null;
//           if (inboundRecord.createdByUserId) {
//             const byId = await prisma.wP_USER_REGISTRATION.findFirst({
//               where: { ID: Number(inboundRecord.createdByUserId) || -1 },
//             });
//             const byUsername = !byId
//               ? await prisma.wP_USER_REGISTRATION.findFirst({
//                   where: { Username: String(inboundRecord.createdByUserId) },
//                 })
//               : null;
//             cancelEnrichment.cancelledByUsername =
//               byId?.Username ||
//               byUsername?.Username ||
//               inboundRecord.createdByUserId ||
//               null;
//           }
//         }
//       } catch {}

//       return res.json({
//         success: true,
//         documentInfo: {
//           uuid: documentData.uuid,
//           submissionUid: documentData.submissionUid,
//           longId: detailsData.longId,
//           irbmlongId: documentData.longId,
//           internalId: documentData.internalId,
//           status: documentData.status,
//           validationResults: validationResults,
//           supplierName: documentData.issuerName,
//           supplierTIN: supplierIdentification.tin,
//           supplierRegistrationNo: supplierIdentification.registrationNo,
//           supplierSstNo: supplierIdentification.taxRegNo,
//           supplierMsicCode:
//             supplierParty.IndustryClassificationCode?.[0]._ ||
//             documentData.supplierMsicCode,
//           supplierAddress:
//             supplierParty.PostalAddress[0].AddressLine.map(
//               (line) => line.Line[0]._
//             )
//               .filter(Boolean)
//               .join(", ") || documentData.supplierAddress,
//           receiverName: documentData.receiverName,
//           receiverTIN: customerIdentification.tin,
//           receiverRegistrationNo: customerIdentification.registrationNo,
//           receiverSstNo: customerIdentification.taxRegNo,
//           receiverAddress:
//             customerParty.PostalAddress[0].AddressLine.map(
//               (line) => line.Line[0]._
//             )
//               .filter(Boolean)
//               .join(", ") || documentData.receiverAddress,
//           ...cancelEnrichment,
//         },
//         supplierInfo: {
//           company:
//             supplierParty.PartyLegalEntity[0].RegistrationName[0]._ ||
//             documentData.supplierName,
//           tin: supplierIdentification.tin,
//           registrationNo: supplierIdentification.registrationNo,
//           taxRegNo: supplierIdentification.taxRegNo,
//           idType: supplierIdentification.idType,
//           idNumber: supplierIdentification.idNumber,
//           msicCode:
//             supplierParty.IndustryClassificationCode?.[0]._ ||
//             documentData.supplierMsicCode,
//           address:
//             supplierParty.PostalAddress[0].AddressLine.map(
//               (line) => line.Line[0]._
//             )
//               .filter(Boolean)
//               .join(", ") || documentData.supplierAddress,
//         },
//         customerInfo: {
//           company:
//             customerParty.PartyLegalEntity[0].RegistrationName[0]._ ||
//             documentData.receiverName,
//           tin: customerIdentification.tin,
//           registrationNo: customerIdentification.registrationNo,
//           taxRegNo: customerIdentification.taxRegNo,
//           idType: customerIdentification.idType,
//           idNumber: customerIdentification.idNumber,
//           address:
//             customerParty.PostalAddress[0].AddressLine.map(
//               (line) => line.Line[0]._
//             )
//               .filter(Boolean)
//               .join(", ") || documentData.receiverAddress,
//         },
//         paymentInfo: {
//           totalIncludingTax:
//             invoice.LegalMonetaryTotal?.[0]?.TaxInclusiveAmount?.[0]._ ||
//             documentData.totalSales,
//           totalExcludingTax:
//             invoice.LegalMonetaryTotal?.[0]?.TaxExclusiveAmount?.[0]._ ||
//             documentData.totalExcludingTax,
//           taxAmount:
//             invoice.TaxTotal?.[0]?.TaxAmount?.[0]._ ||
//             documentData.totalSales - (documentData.totalExcludingTax || 0),
//           irbmUniqueNo: documentData.uuid,
//           irbmlongId: documentData.longId,
//         },
//       });
//     } catch (parseError) {
//       console.error("Error processing parsed document:", parseError);
//       console.log(
//         "Falling back to basic document info due to processing error"
//       );
//       // Handle processing error by returning basic info
//       return res.json(getBasicDocumentInfo());
//     }
//   } catch (error) {
//     console.error("Error fetching document details:", error);
//     return res.status(500).json({
//       success: false,
//       message: error.message || "Failed to fetch document details",
//       error: {
//         name: error.name,
//         details: error.response?.data || error.stack,
//       },
//     });
//   }
// });

/** Build LHDN-shaped /raw payload from the JSON body the client sends to POST /pdf */
function buildPdfRawDataFromClientBody(clientBody, uuid) {
  if (!clientBody || typeof clientBody !== "object") return null;
  const di = clientBody.documentInfo;
  if (!di || typeof di !== "object") return null;
  if (typeof di.document === "string" && di.document.trim()) {
    return {
      document: di.document,
      longId: di.longId ?? di.irbmlongId,
      uuid: di.uuid || uuid,
      internalId: di.internalId,
      typeVersionName: di.typeVersionName,
      dateTimeValidated: di.dateTimeValidated,
      totalNetAmount: di.totalNetAmount,
      digitalSignature: di.digitalSignature,
    };
  }
  if (di.parsedDocument && typeof di.parsedDocument === "object") {
    try {
      return {
        document: JSON.stringify(di.parsedDocument),
        longId: di.longId ?? di.irbmlongId,
        uuid: di.uuid || uuid,
        internalId: di.internalId,
        typeVersionName: di.typeVersionName,
        dateTimeValidated: di.dateTimeValidated,
        totalNetAmount: di.totalNetAmount,
        digitalSignature: di.digitalSignature,
      };
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Same shape as LHDN GET /documents/{uuid}/raw — offline fallbacks when LHDN
 * cannot be used (404 Not Found, 429 Too Many Requests, etc.).
 */
async function fetchRawDataForPdf(uuid, accessToken, lhdnConfig, options = {}) {
  try {
    const response = await axios.get(
      `${lhdnConfig.baseUrl}/api/v1.0/documents/${uuid}/raw`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        timeout: 30000,
      }
    );
    return response.data;
  } catch (err) {
    const status = err.response?.status;
    const useOfflineFallback = status === 404 || status === 429;
    if (!useOfflineFallback) {
      throw err;
    }

    const reason = status === 429 ? "429 rate limit" : "404 not found";
    const fromBody = buildPdfRawDataFromClientBody(options.clientBody, uuid);
    if (fromBody?.document) {
      console.log(
        `[PDF] LHDN /raw ${reason}; using document payload from client body for ${uuid}`
      );
      return fromBody;
    }
    const row = await prisma.wP_INBOUND_STATUS.findUnique({
      where: { uuid },
      select: {
        document: true,
        longId: true,
        uuid: true,
        internalId: true,
        typeVersionName: true,
        dateTimeValidated: true,
        totalNetAmount: true,
      },
    });
    const dbDoc =
      row?.document != null && String(row.document).trim()
        ? String(row.document).trim()
        : null;
    if (dbDoc) {
      console.log(
        `[PDF] LHDN /raw ${reason}; using WP_INBOUND_STATUS.document for ${uuid}`
      );
      return {
        document: dbDoc,
        longId: row.longId,
        uuid: row.uuid,
        internalId: row.internalId,
        typeVersionName: row.typeVersionName,
        dateTimeValidated: row.dateTimeValidated,
        totalNetAmount:
          row.totalNetAmount != null ? Number(row.totalNetAmount) : undefined,
        digitalSignature: null,
      };
    }

    console.warn(
      `[PDF] LHDN /raw ${reason} for ${uuid}: no UBL in request body and WP_INBOUND_STATUS.document is empty — cannot build PDF`
    );
    const noSource = new Error(
      "Cannot generate PDF: MyInvois did not return the raw document and no full invoice (UBL) is stored for this row. The list view only keeps summary fields unless document JSON is saved. Retry when the API is available, or sync in a way that persists the document payload."
    );
    noSource.statusCode = 422;
    noSource.code = "PDF_NO_SOURCE";
    throw noSource;
  }
}

// Helper function to get template data
async function getTemplateData(uuid, accessToken, user, options = {}) {
  // Get LHDN configuration
  const lhdnConfig = await getLHDNConfig();

  const rawData = await fetchRawDataForPdf(
    uuid,
    accessToken,
    lhdnConfig,
    options
  );

  // Get company data using Prisma
  const company = await prisma.wP_COMPANY_SETTINGS.findFirst({
    where: { TIN: user.TIN },
  });

  // Handle company logo
  const logoPath = company?.CompanyImage
    ? path.join(__dirname, "../../public", company.CompanyImage)
    : null;

  let logoBase64;
  try {
    const logoBuffer = await fsPromises.readFile(logoPath);
    const logoExt = path.extname(logoPath).substring(1);
    logoBase64 = `data:image/${logoExt};base64,${logoBuffer.toString(
      "base64"
    )}`;
  } catch (error) {
    logoBase64 = null;
  }

  // Parse document data
  const documentData = JSON.parse(rawData.document);
  const invoice = documentData.Invoice[0];

  const supplierParty = invoice.AccountingSupplierParty[0].Party[0];
  const customerParty = invoice.AccountingCustomerParty[0].Party[0];

  // Generate QR code
  // console.log("Generating QR code...");
  const longId = rawData.longId || rawData.longID;
  const lhdnUuid = rawData.uuid;
  const portalUrl = getPortalUrl(lhdnConfig.environment);
  const qrCodeUrl = `https://${portalUrl}/${lhdnUuid}/share/${longId}`;
  // console.log("QR Code URL:", qrCodeUrl);

  const qrCodeDataUrl = await QRCode.toDataURL(qrCodeUrl, {
    width: 200,
    margin: 2,
    color: { dark: "#000000", light: "#ffffff" },
  });
  // console.log("✓ QR code generated successfully");

  // Get tax information from UBL structure
  const taxTotal = invoice.TaxTotal?.[0];
  const taxSubtotal = taxTotal?.TaxSubtotal?.[0];
  const taxCategory = taxSubtotal?.TaxCategory?.[0];
  const totalTaxAmount = taxTotal?.TaxAmount?.[0]._ || 0;
  // Note: Tax exemption reason should be extracted per line item, not globally

  // Map the tax type according to SDK documentation
  const getTaxTypeDescription = (code) => {
    const taxTypes = {
      "01": "Sales Tax",
      "02": "Service Tax",
      "03": "Tourism Tax",
      "04": "High-Value Goods Tax",
      "05": "Sales Tax on Low Value Goods",
      "06": "Not Applicable",
      "E": "Tax exemption",
    };
    return taxTypes[code] || code;
  };

  const idTypes = ["TIN", "BRN", "NRIC", "Passport", "Army", "SST", "TTX"];
  function getIdTypeAndNumber(partyIdentification) {
    const tinInfo = partyIdentification?.find(
      (id) => id.ID[0].schemeID === "TIN"
    );
    if (!tinInfo) {
      throw new Error("TIN is mandatory and not found.");
    }

    for (const idType of idTypes) {
      if (idType === "TIN") continue;
      const idInfo = partyIdentification?.find(
        (id) => id.ID[0].schemeID === idType
      );
      if (idInfo) {
        return { type: idType, number: idInfo.ID[0]._ };
      }
    }
    return { type: "NA", number: "NA" };
  }

  const supplierIdInfo = getIdTypeAndNumber(
    supplierParty.PartyIdentification,
    idTypes
  );
  const customerIdInfo = getIdTypeAndNumber(
    customerParty.PartyIdentification,
    idTypes
  );

  // First pass: collect all tax rates from non-exempt items to determine standard rate
  const nonExemptTaxRates = [];
  invoice.InvoiceLine?.forEach((line) => {
    const lineTaxCategory =
      line.TaxTotal?.[0]?.TaxSubtotal?.[0]?.TaxCategory?.[0];
    const taxTypeCode = lineTaxCategory?.ID?.[0]._ || "06";
    const taxPercent = parseFloat(lineTaxCategory?.Percent?.[0]._ || 0);

    // Collect non-exempt tax rates
    if (taxTypeCode !== "E" && taxTypeCode !== "06" && taxPercent > 0) {
      nonExemptTaxRates.push(taxPercent);
    }
  });

  // Determine the standard tax rate (most common non-exempt rate, or highest if tied)
  let standardTaxRate = 0;
  if (nonExemptTaxRates.length > 0) {
    // Find the most common tax rate
    const rateFrequency = {};
    nonExemptTaxRates.forEach((rate) => {
      rateFrequency[rate] = (rateFrequency[rate] || 0) + 1;
    });

    // Get the most frequent rate, or highest if tied
    let maxFrequency = 0;
    Object.entries(rateFrequency).forEach(([rate, frequency]) => {
      if (
        frequency > maxFrequency ||
        (frequency === maxFrequency && parseFloat(rate) > standardTaxRate)
      ) {
        maxFrequency = frequency;
        standardTaxRate = parseFloat(rate);
      }
    });
  }

  // console.log(`Standard tax rate determined from invoice: ${standardTaxRate}%`);

  // Process tax information for each line item
  const taxSummary = {};
  const items = await Promise.all(
    invoice.InvoiceLine?.map(async (line, index) => {
      const lineAmount = parseFloat(line.LineExtensionAmount?.[0]._ || 0);
      const lineTax = parseFloat(line.TaxTotal?.[0]?.TaxAmount?.[0]._ || 0);
      const quantity = parseFloat(line.InvoicedQuantity?.[0]._ || 0);
      const unitPrice = parseFloat(line.Price?.[0]?.PriceAmount?.[0]._ || 0);
      const discount = parseFloat(
        line.AllowanceCharge?.[0]?.Amount?.[0]._ || 0
      );
      const unitCode = line.InvoicedQuantity?.[0]?.unitCode || "XNA";
      const taxlineCurrency =
        line.TaxTotal?.[0]?.TaxAmount?.[0]?.currencyID;
      const allowanceCharges = parseFloat(
        line.AllowanceCharge?.[0]?.Amount?.[0]._ || 0
      );

      // Get unit type name
      const unitType = await getUnitType(unitCode);

      // Extract tax information for this line
      const lineTaxCategory =
        line.TaxTotal?.[0]?.TaxSubtotal?.[0]?.TaxCategory?.[0];
      const taxTypeCode = lineTaxCategory?.ID?.[0]._ || "06";
      const taxPercent = parseFloat(lineTaxCategory?.Percent?.[0]._ || 0);

      // Extract tax exemption reason for this line item
      const lineExemptionReason =
        lineTaxCategory?.TaxExemptionReason?.[0]?._ || null;

      // Calculate hypothetical tax for exempt items using standard rate from response
      let hypotheticalTax = "0.00";
      let isExempt = taxTypeCode === "E";
      if (isExempt && standardTaxRate > 0) {
        // Use the standard tax rate determined from other items in the invoice
        hypotheticalTax = ((lineAmount * standardTaxRate) / 100).toLocaleString(
          "en-MY",
          {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          }
        );
      }

      // Add to tax summary
      const taxKey = `${taxTypeCode}_${taxPercent}`;
      if (!taxSummary[taxKey]) {
        taxSummary[taxKey] = {
          taxType: taxTypeCode,
          taxRate: taxPercent,
          baseAmount: 0,
          taxAmount: 0,
          hypotheticalTaxAmount: 0,
          standardTaxRate: standardTaxRate, // Add standard tax rate for reference
          exemptionReason: lineExemptionReason, // Store the exemption reason for this tax type
        };
      }
      taxSummary[taxKey].baseAmount += lineAmount;
      taxSummary[taxKey].taxAmount += lineTax;
      taxSummary[taxKey].hypotheticalTaxAmount +=
        isExempt && standardTaxRate > 0
          ? parseFloat(hypotheticalTax.replace(/,/g, ""))
          : 0;

      // Format quantity with exactly 2 decimal places
      const formattedQuantity = quantity.toLocaleString("en-MY", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
        useGrouping: false,
      });

      // Format unit price with exactly 4 decimal places
      const formattedUnitPrice = unitPrice.toLocaleString("en-MY", {
        minimumFractionDigits: 4,
        maximumFractionDigits: 4,
        useGrouping: false,
      });

      return {
        No: index + 1,
        Cls:
          line.Item?.[0]?.CommodityClassification?.[0]
            ?.ItemClassificationCode?.[0]._ || "NA",
        Description: line.Item?.[0]?.Description?.[0]._ || "NA",
        Quantity: formattedQuantity,
        UOM: unitType || "XNA", // Display unit type name instead of code
        UnitPrice: formattedUnitPrice,
        QtyAmount: lineAmount.toLocaleString("en-MY", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }),
        Disc:
          discount === 0
            ? "0.00"
            : discount.toLocaleString("en-MY", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              }),
        Charges:
          allowanceCharges.toLocaleString("en-MY", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          }) || "0.00",
        LineTaxPercent: taxPercent.toFixed(2),
        LineTaxAmount: lineTax.toLocaleString("en-MY", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }),
        HypotheticalTax: hypotheticalTax, // Add hypothetical tax to line items
        StandardTaxRate: standardTaxRate.toFixed(2), // Add standard tax rate for template logic
        Total: (
          parseFloat(line.ItemPriceExtension?.[0]?.Amount?.[0]._ || 0) + lineTax
        ).toLocaleString("en-MY", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }),
        TaxType: getTaxTypeDescription(taxTypeCode),
      };
    }) || []
  );

  const currentInvoiceType = invoice.InvoiceTypeCode?.[0]._ || "NA";
  const einvoiceType = await getInvoiceTypes(currentInvoiceType);

  const taxSummaryArray = Object.values(taxSummary).map((summary) => ({
    baseAmount: parseFloat(summary.baseAmount).toLocaleString("en-MY", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }),
    taxType: getTaxTypeDescription(summary.taxType),
    taxRate: parseFloat(summary.taxRate).toLocaleString("en-MY", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }),
    taxAmount: parseFloat(summary.taxAmount).toLocaleString("en-MY", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }),
    LHDNtaxExemptionReason: summary.exemptionReason || null, // Use the exemption reason from the tax summary, or null if not applicable
    hypotheticalTaxAmount:
      summary.taxType === "E" && summary.standardTaxRate > 0
        ? parseFloat(summary.hypotheticalTaxAmount).toLocaleString("en-MY", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })
        : "0.00",
    standardTaxRate: summary.standardTaxRate || 0, // Add standard tax rate for template logic
  }));

  // Sort the taxSummaryArray based on the desired order
  const taxTypeOrder = [
    "Service Tax",
    "Sales Tax",
    "Tourism Tax",
    "High-Value Goods Tax",
    "Sales Tax on Low Value Goods",
    "Not Applicable",
    "Tax exemption",
    "Other",
  ];
  taxSummaryArray.sort(
    (a, b) => taxTypeOrder.indexOf(a.taxType) - taxTypeOrder.indexOf(b.taxType)
  );

  const templateData = {
    CompanyLogo: logoBase64,
    companyName:
      supplierParty.PartyLegalEntity?.[0]?.RegistrationName?.[0]._ || "NA",
    companyAddress:
      supplierParty.PostalAddress?.[0]?.AddressLine?.map(
        (line) => line.Line[0]._
      ).join(", ") || "NA",
    companyPhone: supplierParty.Contact?.[0]?.Telephone?.[0]._ || "NA",
    companyEmail: supplierParty.Contact?.[0]?.ElectronicMail?.[0]._ || "NA",

    internalId: rawData.internalId || "NA",

    InvoiceTypeCode: einvoiceType,
    InvoiceTypeName: rawData.typeName || "NA",
    InvoiceVersion: rawData.typeVersionName || "NA",
    InvoiceCode: invoice.ID?.[0]._ || rawData.internalId || "NA",
    UniqueIdentifier: rawData.uuid || "NA",
    lhdnLink: qrCodeUrl,

    dateTimeReceived: new Date(
      invoice.IssueDate[0]._ + "T" + invoice.IssueTime[0]._
    ).toLocaleString(),
    documentCurrency: invoice.DocumentCurrencyCode?.[0]._ || "MYR",
    taxCurrency: invoice.TaxCurrencyCode?.[0]._ || "MYR",
    TaxExchangeRate:
      invoice.TaxExchangeRate?.[0]?.CalculationRate?.[0]._ || "----",
    issueDate: invoice.IssueDate?.[0]._ || "NA",
    issueTime: invoice.IssueTime?.[0]._ || "NA",

    OriginalInvoiceRef:
      invoice.BillingReference?.[0]?.InvoiceDocumentReference?.[0]?.ID?.[0]._ ||
      "Not Applicable",
    OriginalInvoiceDateTime: invoice.IssueDate?.[0]._
      ? new Date(
          invoice.IssueDate[0]._ + "T" + invoice.IssueTime[0]._
        ).toLocaleString()
      : "Not Applicable",
    OriginalInvoiceStartDate:
      invoice.InvoicePeriod?.[0]?.StartDate?.[0]._ || "-- / -- / --",
    OriginalInvoiceEndDate:
      invoice.InvoicePeriod?.[0]?.EndDate?.[0]._ || "-- / -- / --",
    OriginalInvoiceDescription:
      invoice.InvoicePeriod?.[0]?.Description?.[0]._ || "",

    SupplierTIN:
      supplierParty.PartyIdentification?.find(
        (id) => id.ID[0].schemeID === "TIN"
      )?.ID[0]._ || "NA",
    SupplierRegistrationNumber:
      supplierParty.PartyIdentification?.find(
        (id) => id.ID[0].schemeID === "BRN"
      )?.ID[0]._ || "NA",
    SupplierSSTID:
      supplierParty.PartyIdentification?.find(
        (id) => id.ID[0].schemeID === "SST"
      )?.ID[0]._ || "NA",
    SupplierMSICCode:
      supplierParty.IndustryClassificationCode?.[0]._ || "00000",
    SupplierBusinessActivity:
      supplierParty.IndustryClassificationCode?.[0]?.name || "NOT APPLICABLE",
    SupplierIdType: supplierIdInfo.type,
    SupplierIdNumber: supplierIdInfo.number,

    BuyerTIN:
      customerParty.PartyIdentification?.find(
        (id) => id.ID[0].schemeID === "TIN"
      )?.ID[0]._ || "NA",
    BuyerName:
      customerParty.PartyLegalEntity?.[0]?.RegistrationName?.[0]._ || "NA",
    BuyerPhone: customerParty.Contact?.[0]?.Telephone?.[0]._ || "NA",
    BuyerEmail: customerParty.Contact?.[0]?.ElectronicMail?.[0]._ || "NA",
    BuyerRegistrationNumber:
      customerParty.PartyIdentification?.find(
        (id) => id.ID[0].schemeID === "BRN"
      )?.ID[0]._ || "NA",
    BuyerAddress:
      customerParty.PostalAddress?.[0]?.AddressLine?.map(
        (line) => line.Line[0]._
      ).join(", ") || "NA",
    BuyerSSTID:
      customerParty.PartyIdentification?.find(
        (id) => id.ID[0].schemeID === "SST"
      )?.ID[0]._ || "NA",
    BuyerMSICCode: customerParty.IndustryClassificationCode?.[0]._ || "00000",
    BuyerBusinessActivity:
      customerParty.IndustryClassificationCode?.[0]?.name || "NOT APPLICABLE",
    BuyerIdType: customerIdInfo.type,
    BuyerIdNumber: customerIdInfo.number,

    Prepayment: parseFloat(
      invoice.LegalMonetaryTotal?.[0]?.PrepaidAmount?.[0]._ || 0
    ).toLocaleString("en-MY", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }),
    TotalNetAmount: (() => {
      const fromRaw =
        rawData.totalNetAmount != null && rawData.totalNetAmount !== ""
          ? parseFloat(rawData.totalNetAmount)
          : NaN;
      const fromInvoice = parseFloat(
        invoice.LegalMonetaryTotal?.[0]?.TaxExclusiveAmount?.[0]._ || 0
      );
      const n = !Number.isNaN(fromRaw) ? fromRaw : fromInvoice;
      return n.toLocaleString("en-MY", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
    })(),
    Subtotal: parseFloat(
      invoice.LegalMonetaryTotal?.[0]?.LineExtensionAmount?.[0]._ || 0
    ).toLocaleString("en-MY", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }),
    TotalExcludingTax: parseFloat(
      invoice.LegalMonetaryTotal?.[0]?.TaxExclusiveAmount?.[0]._ || 0
    ).toLocaleString("en-MY", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }),
    TotalIncludingTax: parseFloat(
      invoice.LegalMonetaryTotal?.[0]?.TaxInclusiveAmount?.[0]._ || 0
    ).toLocaleString("en-MY", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }),
    TotalPayableAmount: parseFloat(
      invoice.LegalMonetaryTotal?.[0]?.PayableAmount?.[0]._ || 0
    ).toLocaleString("en-MY", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }),
    TotalTaxAmount: Object.values(taxSummary)
      .reduce((sum, item) => sum + item.taxAmount, 0)
      .toLocaleString("en-MY", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }),

    TaxRate: Object.values(taxSummary)
      .reduce((sum, item) => sum + item.taxRate, 0)
      .toLocaleString("en-MY", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }),
    TaxAmount: Object.values(taxSummary)
      .reduce((sum, item) => sum + item.taxAmount, 0)
      .toLocaleString("en-MY", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }),

    items: items,

    TaxType: taxCategory?.ID?.[0]._ || "06",
    TaxSchemeId: getTaxTypeDescription(taxCategory?.ID?.[0]._ || "06"),

    // taxSummary: taxSummaryArray.map(item => ({
    //     taxType: item.taxType,
    //     taxRate: item.taxRate,
    //     totalAmount: item.baseAmount || '0.00',
    //     totalTaxAmount: item.taxAmount || '0.00'
    // })),

    taxSummary: taxSummaryArray.map((item) => ({
      taxType: item.taxType,
      taxRate: item.taxRate,
      totalAmount: item.baseAmount || "0.00",
      totalTaxAmount: item.taxAmount || "0.00",
      hypotheticalTaxAmount: item.hypotheticalTaxAmount || "0.00",
      LHDNtaxExemptionReason: item.LHDNtaxExemptionReason || null, // Use the exemption reason from the item, or null if not applicable
    })),

    companyName:
      supplierParty.PartyLegalEntity?.[0]?.RegistrationName?.[0]._ ||
      "NNot ApplicableA",
    companyAddress:
      supplierParty.PostalAddress?.[0]?.AddressLine?.map(
        (line) => line.Line[0]._
      ).join(", ") || "Not Applicable",
    companyPhone:
      supplierParty.Contact?.[0]?.Telephone?.[0]._ || "Not Applicable",
    companyEmail:
      supplierParty.Contact?.[0]?.ElectronicMail?.[0]._ || "Not Applicable",

    InvoiceVersionCode:
      invoice.InvoiceTypeCode?.[0].listVersionID || "Not Applicable",
    InvoiceVersion: rawData.typeVersionName || "NA",
    InvoiceCode: invoice.ID?.[0]._ || rawData.internalId || "Not Applicable",
    UniqueIdentifier: rawData.uuid || "Not Applicable",
    LHDNlongId: longId || "Not Applicable",

    dateTimeReceived: new Date(
      invoice.IssueDate[0]._ + "T" + invoice.IssueTime[0]._
    ).toLocaleDateString("en-GB"),
    issueDate: invoice.IssueDate?.[0]._
      ? new Date(invoice.IssueDate[0]._).toLocaleDateString("en-GB")
      : "Not Applicable",
    issueTime: invoice.IssueTime?.[0]._ || "Not Applicable",

    startPeriodDate:
      invoice.InvoicePeriod?.[0]?.StartDate?.[0]._ || "Not Applicable",
    endPeriodDate:
      invoice.InvoicePeriod?.[0]?.EndDate?.[0]._ || "Not Applicable",
    dateDescription:
      invoice.InvoicePeriod?.[0]?.Description?.[0]._ || "Not Applicable",

    qrCode: qrCodeDataUrl,
    QRLink: qrCodeUrl,
    DigitalSignature: rawData.digitalSignature || "-",
    validationDateTime: (() => {
      if (!rawData.dateTimeValidated) return "N/A";
      const d = new Date(rawData.dateTimeValidated);
      return Number.isNaN(d.getTime())
        ? String(rawData.dateTimeValidated)
        : d.toLocaleString();
    })(),
  };

  return templateData;
}

//route to check if PDF exists
router.get("/documents/:uuid/check-pdf", async (req, res) => {
  const { uuid } = req.params; // longId is not used
  const requestId = req.requestId;

  try {
    // console.log(`[${requestId}] Checking PDF existence for ${uuid}`);
    const tempDir = path.join(__dirname, "../../public/temp");
    const pdfPath = path.join(tempDir, `${uuid}.pdf`);
    const hashPath = path.join(tempDir, `${uuid}.hash`);

    console.log(`[${requestId}] Paths:`, {
      pdfPath,
      hashPath,
    });

    try {
      await fsPromises.access(pdfPath);
      console.log(`[${requestId}] PDF exists at ${pdfPath}`);
      return res.json({
        exists: true,
        url: `/temp/${uuid}.pdf`,
      });
    } catch (error) {
      console.log(`[${requestId}] PDF not found at ${pdfPath}`);
      return res.json({ exists: false });
    }
  } catch (error) {
    console.error(`[${requestId}] Error checking PDF:`, error);
    return res.status(500).json({
      success: false,
      message: "Failed to check PDF existence",
      error: error.message,
    });
  }
});

// Update PDF generation route
router.post("/documents/:uuid/pdf", async (req, res) => {
  const { uuid } = req.params;
  const requestId = req.requestId;

  try {
    console.log(`[${requestId}] Starting PDF Generation Process for ${uuid}`);

    const tempDir = path.join(__dirname, "../../public/temp");
    const pdfPath = path.join(tempDir, `${uuid}.pdf`);
    const hashPath = path.join(tempDir, `${uuid}.hash`);

    console.log(`[${requestId}] Paths:`, {
      tempDir,
      pdfPath,
      hashPath,
    });

    // Check directory exists
    try {
      await fsPromises.access(tempDir);
      console.log(`[${requestId}] Temp directory exists`);
    } catch {
      console.log(`[${requestId}] Creating temp directory`);
      await fsPromises.mkdir(tempDir, { recursive: true });
    }

    // Auth check
    if (!req.session?.user) {
      console.log(`[${requestId}] No user session found`);
      return res.status(401).json({
        success: false,
        message: "User not authenticated",
      });
    }

    console.log(`[${requestId}] User authenticated:`, {
      id: req.session.user.id,
      TIN: req.session.user.TIN,
    });

    const forceRegenerate = req.query.force === "true";
    console.log(`[${requestId}] Force regenerate:`, forceRegenerate);

    // Reuse PDF/HTML already on disk (e.g. generated earlier when LHDN worked).
    // Without this, a 404/429 from /raw blocks preview even when the file exists.
    if (!forceRegenerate) {
      try {
        await fsPromises.access(pdfPath);
        console.log(
          `[${requestId}] Existing PDF on disk for ${uuid} — returning without calling LHDN`
        );
        return res.json({
          success: true,
          url: `/temp/${uuid}.pdf`,
          cached: true,
          fromDisk: true,
          message: "Loading existing PDF from server temp",
        });
      } catch {
        /* no pdf */
      }
      const htmlFallbackPath = path.join(tempDir, `${uuid}.html`);
      try {
        await fsPromises.access(htmlFallbackPath);
        console.log(
          `[${requestId}] Existing HTML fallback on disk for ${uuid} — returning without calling LHDN`
        );
        return res.json({
          success: true,
          url: `/temp/${uuid}.html`,
          cached: true,
          fromDisk: true,
          isEmergencyFallback: true,
          message: "Loading existing HTML preview from server temp",
        });
      } catch {
        /* no html */
      }
    }

    // Check cache for template data first
    let templateData = lhdnCache.get('pdf-template', uuid, req.session.user.id);

    if (!templateData) {
      console.log(`[${requestId}] Fetching fresh template data...`);
      templateData = await getTemplateData(
        uuid,
        req.session.accessToken,
        req.session.user,
        { clientBody: req.body }
      );

      // Cache the template data
      lhdnCache.set('pdf-template', uuid, templateData, req.session.user.id);
      console.log(`[${requestId}] Template data fetched and cached`);
    } else {
      console.log(`[${requestId}] Using cached template data`);
    }

    // Check if regeneration needed
    if (!forceRegenerate) {
      try {
        const storedHash = await fsPromises.readFile(hashPath, "utf8");
        const currentHash = generateTemplateHash(templateData);

        console.log(`[${requestId}] Hash comparison:`, {
          stored: storedHash.substring(0, 8),
          current: currentHash.substring(0, 8),
          matches: storedHash === currentHash,
        });

        if (storedHash === currentHash) {
          // Check if the actual PDF file exists before returning cached response
          const htmlPath = path.join(tempDir, `${uuid}.html`);

          try {
            await fsPromises.access(pdfPath);
            console.log(`[${requestId}] Using cached PDF - file exists`);
            return res.json({
              success: true,
              url: `/temp/${uuid}.pdf`,
              cached: true,
              message: "Loading existing PDF from cache...",
            });
          } catch (pdfError) {
            // PDF doesn't exist, check for HTML fallback
            try {
              await fsPromises.access(htmlPath);
              console.log(`[${requestId}] Using cached HTML fallback - file exists`);
              return res.json({
                success: true,
                url: `/temp/${uuid}.html`,
                cached: true,
                message: "Loading existing HTML fallback from cache...",
                isEmergencyFallback: true,
              });
            } catch (htmlError) {
              console.log(`[${requestId}] Neither PDF nor HTML cached file exists, regenerating...`);
              // Neither file exists, continue to regeneration
            }
          }
        }
      } catch (error) {
        console.log(`[${requestId}] Cache check failed:`, error.message);
      }
    }

    // Generate new PDF
    console.log(`[${requestId}] Generating new PDF...`);
    const newHash = generateTemplateHash(templateData);

    const templatePath = path.join(
      __dirname,
      "../../src/reports/original-invoice-template.html"
    );
    console.log(`[${requestId}] Using template:`, templatePath);

    const templateContent = await fsPromises.readFile(templatePath, "utf8");
    const template = jsrender.templates(templateContent);
    const html = template.render(templateData);

    console.log(
      `[${requestId}] Using enhanced PDF generation service directly...`
    );

    // Generate PDF using enhanced PDF generation service
    console.log(`[${requestId}] Generating PDF using enhanced service...`);

    let pdfBuffer;
    let isEmergencyFallback = false;
    try {
      // Use the enhanced PDF generation service directly
      pdfBuffer = await pdfGenerationService.generatePDF(html, {
        requestId,
        uuid,
        format: "A4",
        printBackground: true,
        margin: { top: "1cm", right: "1cm", bottom: "1cm", left: "1cm" },
      });

      // Check if this is an emergency HTML fallback
      const bufferString = pdfBuffer.toString('utf8');
      if (bufferString.includes('Emergency PDF Fallback')) {
        isEmergencyFallback = true;
        console.log(`[${requestId}] Emergency HTML fallback generated due to permission issues`);
      } else {
        console.log(`[${requestId}] PDF generated successfully using enhanced service`);
      }
    } catch (serviceError) {
      console.error(`[${requestId}] Enhanced PDF service failed:`, serviceError.message);
      throw new Error(`PDF generation service error. Please try again.`);
    }

    // Save files - handle both PDF and HTML fallback
    if (isEmergencyFallback) {
      // Save as HTML file for emergency fallback
      const htmlPath = path.join(tempDir, `${uuid}.html`);
      console.log(`[${requestId}] Saving emergency HTML fallback...`);
      await fsPromises.writeFile(htmlPath, pdfBuffer);
      await fsPromises.writeFile(hashPath, newHash);

      console.log(`[${requestId}] Emergency HTML fallback saved:`, {
        path: htmlPath,
        hash: newHash.substring(0, 8),
        size: pdfBuffer.length,
      });

      return res.json({
        success: true,
        url: `/temp/${uuid}.html`,
        cached: false,
        message: "Emergency HTML fallback generated - PDF unavailable due to system permissions",
        isEmergencyFallback: true,
      });
    } else {
      // Save as normal PDF
      console.log(`[${requestId}] Saving PDF and hash...`);
      await fsPromises.writeFile(pdfPath, pdfBuffer);
      await fsPromises.writeFile(hashPath, newHash);

      console.log(`[${requestId}] PDF generated successfully:`, {
        path: pdfPath,
        hash: newHash.substring(0, 8),
        size: pdfBuffer.length,
      });

      return res.json({
        success: true,
        url: `/temp/${uuid}.pdf`,
        cached: false,
        message: "New PDF generated successfully",
      });
    }
  } catch (error) {
    console.error(`[${requestId}] PDF Generation Error:`, {
      message: error.message,
      stack: error.stack,
      name: error.name,
    });

    // Handle specific PDF generation errors
    if (
      error.message.includes("Failed to launch the browser process") ||
      error.message.includes("chrome-pdf") ||
      error.message.includes("All Chrome configurations failed") ||
      error.message.includes("Protocol error") ||
      error.message.includes("Target closed")
    ) {
      return res.status(500).json({
        success: false,
        message:
          "Failed to generate PDF: PDF generation service error. Please try again.",
        details:
          "PDF generation service encountered an error. This may be temporary.",
        troubleshooting: "Please contact support if the issue persists.",
        errorType: "BROWSER_LAUNCH_ERROR"
      });
    }

    if (error.response?.status === 429) {
      return res.status(429).json({
        success: false,
        message: "Server is busy. Please try again later.",
        retryAfter: error.response.headers["retry-after"] || 30,
      });
    }

    if (error.statusCode === 422 || error.code === "PDF_NO_SOURCE") {
      return res.status(422).json({
        success: false,
        code: "PDF_NO_SOURCE",
        message: error.message,
      });
    }

    return res.status(500).json({
      success: false,
      message: `Failed to generate PDF: ${error.message}`,
      details: error.stack,
    });
  }
});

// TIN Validation route
router.get("/taxpayer/validate/:tin", limiter, async (req, res) => {
  const { tin } = req.params;
  const { idType, idValue } = req.query;
  const requestId =
    req.requestId ||
    req.headers["x-request-id"] ||
    Math.random().toString(36).substring(2, 15);

  console.log(`[${requestId}] TIN Validation Request:`, {
    tin,
    idType,
    idValue,
  });

  try {
    // Input validation
    if (!tin || !idType || !idValue) {
      return res.status(400).json({
        success: false,
        message: "Missing required parameters",
        error: {
          code: "BAD_ARGUMENT",
          details: {
            tin: !tin ? "TIN is required" : null,
            idType: !idType ? "ID Type is required" : null,
            idValue: !idValue ? "ID Value is required" : null,
          },
        },
      });
    }

    // Validate ID Type
    const validIdTypes = ["NRIC", "PASSPORT", "BRN", "ARMY"];
    if (!validIdTypes.includes(idType.toUpperCase())) {
      return res.status(400).json({
        success: false,
        message: "Invalid ID Type",
        error: {
          code: "BAD_ARGUMENT",
          details: {
            idType: `ID Type must be one of: ${validIdTypes.join(", ")}`,
          },
        },
      });
    }

    // Get LHDN configuration
    const lhdnConfig = await getLHDNConfig();

    // No caching - fetch fresh validation data
    
    // Prepare standard LHDN API headers according to SDK specification
    const headers = {
      Authorization: `Bearer ${req.session.accessToken}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Request-ID": requestId,
      "X-Date": req.headers["x-date"] || new Date().toISOString(),
      "X-Client-ID": req.headers["x-client-id"] || "eInvoice-WebApp",
      "X-Forwarded-For": req.headers["x-forwarded-for"] || req.ip,
      "X-User-Agent": req.headers["x-user-agent"] || req.headers["user-agent"],
      "X-Channel": req.headers["x-channel"] || "Web",
    };

    // Add User session related headers if available
    if (req.session?.user) {
      headers["X-User-ID"] = req.session.user.id;
      headers["X-User-TIN"] = req.session.user.TIN;
      headers["X-User-Name"] = req.session.user.username;
    }

    // Make API call to LHDN
    console.log(
      `[${requestId}] Calling LHDN API for TIN validation with standard headers...`
    );
    await axios.get(
      // Response is not used directly
      `${lhdnConfig.baseUrl}/api/v1.0/taxpayer/validate/${tin}`,
      {
        params: {
          idType: idType.toUpperCase(),
          idValue: idValue,
        },
        headers: headers,
        timeout: lhdnConfig.timeout,
      }
    );

    // Log successful validation
    await LoggingService.log({
      description: `TIN Validation successful for ${tin}`,
      username: req?.session?.user?.username || "System",
      userId: req?.session?.user?.id,
      ipAddress: req?.ip,
      logType: LOG_TYPES.INFO,
      module: MODULES.API,
      action: ACTIONS.VALIDATE,
      status: STATUS.SUCCESS,
      details: { tin, idType, idValue, requestId },
    });

    // Return the successful result
    const validationResult = {
      isValid: true,
      tin: tin,
      idType: idType,
      idValue: idValue,
      timestamp: new Date().toISOString(),
      requestId: requestId,
    };

    return res.json({
      success: true,
      result: validationResult,
      cached: false,
    });
  } catch (error) {
    console.error(`[${requestId}] TIN Validation Error:`, error);

    // Log validation error
    await LoggingService.log({
      description: `TIN Validation failed for ${tin}: ${error.message}`,
      username: req?.session?.user?.username || "System",
      userId: req?.session?.user?.id,
      ipAddress: req?.ip,
      logType: LOG_TYPES.ERROR,
      module: MODULES.API,
      action: ACTIONS.VALIDATE,
      status: STATUS.FAILED,
      details: { tin, idType, idValue, error: error.message, requestId },
    });

    // Handle specific error cases
    if (error.response?.status === 404) {
      return res.status(404).json({
        success: false,
        message: "Invalid TIN or ID combination",
        error: {
          code: "NOT_FOUND",
          details:
            "The provided TIN and ID combination cannot be found or is invalid",
          requestId: requestId,
        },
      });
    }

    if (error.response?.status === 400) {
      return res.status(400).json({
        success: false,
        message: "Invalid input parameters",
        error: {
          code: "BAD_ARGUMENT",
          details:
            error.response.data?.message ||
            "The provided parameters are invalid",
          requestId: requestId,
        },
      });
    }

    if (error.response?.status === 429) {
      return res.status(429).json({
        success: false,
        message: "Rate limit exceeded",
        error: {
          code: "RATE_LIMIT_EXCEEDED",
          details: "Too many validation requests. Please try again later.",
          retryAfter: error.response.headers["retry-after"] || 60,
          requestId: requestId,
        },
      });
    }

    // Generic error response
    return res.status(500).json({
      success: false,
      message: "TIN validation failed",
      error: {
        code: "INTERNAL_SERVER_ERROR",
        details: error.message,
        requestId: requestId,
      },
    });
  }
});

// Refresh endpoint
router.post("/documents/refresh", async (req, res) => {
  // console.log("LHDN documents refresh endpoint hit");
  try {
    if (!req.session?.user) {
      // console.log("No user session found");
      return handleAuthError(req, res);
    }

    // console.log("User from session:", req.session.user);

    try {
      // Get LHDN configuration
      const lhdnConfig = await getLHDNConfig();

      // Fetch documents with multiple pages
      // console.log("Fetching fresh data from LHDN API with pagination...");

      // First, check for records with missing issuerName using Prisma
      const docsWithMissingData = await prisma.wP_INBOUND_STATUS.findMany({
        where: {
          OR: [
            { issuerTin: null },
            { issuerTin: "NULL" },
            { issuerTin: "" },
            { issuerName: null },
            { issuerName: "NULL" },
            { issuerName: "" },
          ],
        },
        select: { uuid: true },
      });

      if (docsWithMissingData.length > 0) {
        // console.log(
        //   `Found ${docsWithMissingData.length} documents with missing issuerName to update`
        // );
      }

      // Create array to hold all documents
      const allDocuments = [];
      let pageNo = 1;
      const pageSize = 100;
      let hasMorePages = true;

      // Fetch up to 5 pages (500 documents)
      const maxPages = 5;

      while (hasMorePages && pageNo <= maxPages) {
        try {
          console.log(`Fetching page ${pageNo} of LHDN documents...`);
          const response = await axios.get(
            `${lhdnConfig.baseUrl}/api/v1.0/documents/recent`,
            {
              params: {
                pageNo: pageNo,
                pageSize: pageSize,
                sortBy: "dateTimeValidated",
                sortOrder: "desc",
              },
              headers: {
                Authorization: `Bearer ${
                  req.session.lhdn?.accessToken || req.session.accessToken
                }`,
                Accept: "application/json",
                "Content-Type": "application/json",
              },
              timeout: lhdnConfig.timeout,
            }
          );

          const pageDocuments = response.data.result || [];
          console.log(
            `Fetched ${pageDocuments.length} documents from page ${pageNo}`
          );

          // Log first document to see what fields are actually returned
          if (pageDocuments.length > 0) {
            console.log("Sample document from LHDN API:", JSON.stringify(pageDocuments[0], null, 2));
          }

          // If we got fewer documents than pageSize, we've reached the end
          if (pageDocuments.length < pageSize) {
            hasMorePages = false;
          }

          // Process each document to ensure supplier/issuer mapping is correct
          const processedDocuments = pageDocuments.map((doc) => {
            // Log what fields are available
            const hasIssuerFields = doc.issuerName || doc.supplierName;
            const hasReceiverFields = doc.receiverName || doc.buyerName;
            
            if (!hasIssuerFields || !hasReceiverFields) {
              console.log(`⚠️ Document ${doc.uuid} missing party fields:`, {
                hasIssuerName: !!doc.issuerName,
                hasSupplierName: !!doc.supplierName,
                hasReceiverName: !!doc.receiverName,
                hasBuyerName: !!doc.buyerName
              });
            }

            return {
              ...doc,
              // Important: Map supplierName to issuerName if issuerName is missing
              issuerName: doc.issuerName || doc.supplierName || null,
              issuerTin:
                doc.issuerTIN ||
                doc.issuerTin ||
                doc.supplierTin ||
                doc.supplierTIN ||
                null,
              receiverName: doc.receiverName || doc.buyerName || null,
              receiverId:
                doc.receiverId || doc.buyerTin || doc.buyerTIN || null,
            };
          });

          console.log(`Processed ${processedDocuments.length} documents with mapping`);

          // Add to our collection
          allDocuments.push(...processedDocuments);

          // Move to next page
          pageNo++;

          // Small delay to avoid overwhelming the API
          await delay(500);
        } catch (pageError) {
          console.error(`Error fetching page ${pageNo}:`, pageError.message);
          // Stop fetching more pages on error
          hasMorePages = false;
        }
      }

      console.log(
        `Total fetched: ${allDocuments.length} documents from ${
          pageNo - 1
        } pages`
      );

      // Save all fetched documents to database
      if (allDocuments.length > 0) {
        await saveInboundStatus({ result: allDocuments });
      }

      // Process documents with missing data separately if API fetch didn't update them
      if (docsWithMissingData.length > 0) {
        console.log(
          `Fetching individual details for ${docsWithMissingData.length} documents with missing data...`
        );
        let updatedCount = 0;

        // Process in batches to avoid overwhelming the system
        const batchSize = 10;
        for (let i = 0; i < docsWithMissingData.length; i += batchSize) {
          const batch = docsWithMissingData.slice(i, i + batchSize);

          await Promise.all(
            batch.map(async (doc) => {
              try {
                // Fetch individual document details from API
                const apiEndpoint = `${lhdnConfig.baseUrl}/api/v1.0/documents/${doc.uuid}/details`;
                const apiResponse = await axios.get(apiEndpoint, {
                  headers: {
                    Authorization: `Bearer ${
                      req.session.lhdn?.accessToken || req.session.accessToken
                    }`,
                    "Content-Type": "application/json",
                  },
                  timeout: lhdnConfig.timeout,
                });

                // Look for supplier/issuer name in the response
                const responseData = apiResponse.data;
                const supplierName =
                  responseData.supplierName ||
                  responseData.issuerName ||
                  responseData.document?.supplierName ||
                  responseData.document?.issuerName;

                if (supplierName) {
                  // Update the database record using Prisma
                  await prisma.wP_INBOUND_STATUS.update({
                    where: { uuid: doc.uuid },
                    data: {
                      issuerName: supplierName,
                      last_sync_date: new Date(),
                    },
                  });
                  updatedCount++;
                  console.log(
                    `Updated issuerName to "${supplierName}" for UUID: ${doc.uuid}`
                  );
                } else {
                  console.log(
                    `Could not find supplierName in API response for UUID: ${doc.uuid}`
                  );

                  // Try alternate endpoint as fallback
                  try {
                    const rawDocEndpoint = `${lhdnConfig.baseUrl}/api/v1.0/documents/${doc.uuid}/raw`;
                    const rawDocResponse = await axios.get(rawDocEndpoint, {
                      headers: {
                        Authorization: `Bearer ${
                          req.session.lhdn?.accessToken ||
                          req.session.accessToken
                        }`,
                        "Content-Type": "application/json",
                      },
                      timeout: lhdnConfig.timeout,
                    });

                    // Parse raw document for supplier info
                    const rawData = rawDocResponse.data;
                    const parsedSupplierName =
                      rawData.AccountingSupplierParty?.Party?.PartyLegalEntity
                        ?.RegistrationName?.value ||
                      rawData.AccountingSupplierParty?.Party?.PartyName?.Name
                        ?.value;

                    if (parsedSupplierName) {
                      await prisma.wP_INBOUND_STATUS.update({
                        where: { uuid: doc.uuid },
                        data: {
                          issuerName: parsedSupplierName,
                          last_sync_date: new Date(),
                        },
                      });
                      updatedCount++;
                      console.log(
                        `Updated issuerName to "${parsedSupplierName}" from raw data for UUID: ${doc.uuid}`
                      );
                    }
                  } catch (rawError) {
                    console.error(
                      `Error fetching raw document for ${doc.uuid}:`,
                      rawError.message
                    );
                  }
                }
              } catch (detailError) {
                console.error(
                  `Error fetching details for ${doc.uuid}:`,
                  detailError.message
                );
              }

              // Small delay between requests
              await delay(200);
            })
          );
        }

        console.log(
          `Updated ${updatedCount} documents with missing issuerName`
        );
      }

      // Log successful refresh
      await LoggingService.log({
        description: `Successfully refreshed ${allDocuments.length} documents from LHDN`,
        username: req.session.user.username,
        userId: req.session.user.id,
        ipAddress: req.ip,
        logType: LOG_TYPES.INFO,
        module: MODULES.API,
        action: ACTIONS.READ,
        status: STATUS.SUCCESS,
        details: { count: allDocuments.length },
      });

      // Return success response
      res.json({
        success: true,
        message: "Successfully refreshed data from LHDN",
        count: allDocuments.length,
        missingDataUpdated: docsWithMissingData.length > 0,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error("Error refreshing LHDN data:", error);

      // Log error
      await LoggingService.log({
        description: `Error refreshing LHDN data: ${error.message}`,
        username: req.session.user.username,
        userId: req.session.user.id,
        ipAddress: req.ip,
        logType: LOG_TYPES.ERROR,
        module: MODULES.API,
        action: ACTIONS.READ,
        status: STATUS.FAILED,
        details: { error: error.message },
      });

      // Handle specific error cases
      if (error.response?.status === 429) {
        return res.status(429).json({
          success: false,
          error: {
            code: "RATE_LIMIT_EXCEEDED",
            message: "Rate limit exceeded. Please try again later.",
            retryAfter: error.response.headers["retry-after"] || 30,
          },
        });
      }

      if (error.code === "ECONNABORTED") {
        return res.status(504).json({
          success: false,
          error: {
            code: "TIMEOUT",
            message: "Request timed out. Please try again.",
            details: error.message,
          },
        });
      }

      const statusCode = error.response?.status || 500;
      res.status(statusCode).json({
        success: false,
        error: {
          code: error.code || "REFRESH_ERROR",
          message: error.message || "Failed to refresh LHDN data",
          details: error.response?.data?.error || error.message,
        },
      });
    }
  } catch (error) {
    console.error("Error in refresh endpoint:", error);
    res.status(500).json({
      success: false,
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: "An unexpected error occurred",
        details: error.message,
      },
    });
  }
});

// Sync strategy configuration endpoint
router.get("/sync/config", async (req, res) => {
  try {
    // Get current sync configuration
    const config = {
      syncStrategy: "incremental", // Default strategy
      incrementalSync: true,
      maxIncrementalPages: 5,
      syncThresholdMinutes: 15,
      rateLimitHandling: {
        enabled: true,
        adaptiveDelay: true,
        baseDelay: 500,
        maxDelay: 60000,
      },
      paginationControl: {
        smartPagination: true,
        earlyStopThreshold: 10,
        maxConsecutiveErrors: 3,
        pageSize: 100,
      },
    };

    res.json({
      success: true,
      config,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error getting sync config:", error);
    res.status(500).json({
      success: false,
      error: {
        code: "CONFIG_ERROR",
        message: error.message,
      },
    });
  }
});

// Update sync strategy configuration
router.post("/sync/config", async (req, res) => {
  try {
    const {
      syncStrategy,
      incrementalSync,
      maxIncrementalPages,
      syncThresholdMinutes,
    } = req.body;

    // Validate sync strategy
    if (
      syncStrategy &&
      !["incremental", "full", "smart"].includes(syncStrategy)
    ) {
      return res.status(400).json({
        success: false,
        error: {
          code: "INVALID_STRATEGY",
          message: "Sync strategy must be: incremental, full, or smart",
        },
      });
    }

    // Validate numeric parameters
    if (
      maxIncrementalPages &&
      (maxIncrementalPages < 1 || maxIncrementalPages > 20)
    ) {
      return res.status(400).json({
        success: false,
        error: {
          code: "INVALID_PAGES",
          message: "Max incremental pages must be between 1 and 20",
        },
      });
    }

    // Log configuration change
    await LoggingService.log({
      description: `Sync configuration updated: ${JSON.stringify(req.body)}`,
      username: req?.session?.user?.username || "System",
      userId: req?.session?.user?.id,
      ipAddress: req?.ip,
      logType: LOG_TYPES.INFO,
      module: MODULES.API,
      action: ACTIONS.UPDATE,
      status: STATUS.SUCCESS,
      details: req.body,
    });

    res.json({
      success: true,
      message: "Sync configuration updated successfully",
      config: req.body,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error updating sync config:", error);
    res.status(500).json({
      success: false,
      error: {
        code: "CONFIG_UPDATE_ERROR",
        message: error.message,
      },
    });
  }
});

// Background sync endpoint - Optimized for low-impact incremental sync
router.post("/sync/background", async (req, res) => {
  try {
    console.log("Starting background sync with optimized settings");

    // Set background sync parameters for minimal impact
    req.query.incrementalSync = "true";
    req.query.maxIncrementalPages = "3"; // Limit to 3 pages for background sync
    req.query.forceRefresh = "false";

    // Log background sync start
    await LoggingService.log({
      description: "Background sync started",
      username: req?.session?.user?.username || "System",
      userId: req?.session?.user?.id,
      ipAddress: req?.ip,
      logType: LOG_TYPES.INFO,
      module: MODULES.API,
      action: ACTIONS.READ,
      status: STATUS.PENDING,
      details: { type: "background_sync" },
    });

    // Perform incremental fetch with background-optimized settings
    const apiData = await fetchRecentDocuments(req);

    // Only save if we got new data
    if (apiData && apiData.result && apiData.result.length > 0) {
      await saveInboundStatus(apiData);

      console.log(
        `Background sync completed: ${apiData.result.length} documents processed`
      );

      // Log successful background sync
      await LoggingService.log({
        description: `Background sync completed: ${apiData.result.length} documents`,
        username: req?.session?.user?.username || "System",
        userId: req?.session?.user?.id,
        ipAddress: req?.ip,
        logType: LOG_TYPES.INFO,
        module: MODULES.API,
        action: ACTIONS.READ,
        status: STATUS.SUCCESS,
        details: {
          type: "background_sync",
          documentCount: apiData.result.length,
          fromApi: apiData.fromApi,
          fromDatabase: apiData.fromDatabase,
        },
      });

      res.json({
        success: true,
        message: "Background sync completed successfully",
        count: apiData.result.length,
        fromApi: apiData.fromApi,
        fromDatabase: apiData.fromDatabase,
        timestamp: new Date().toISOString(),
      });
    } else {
      console.log("Background sync: No new documents found");

      res.json({
        success: true,
        message: "Background sync completed - no new documents",
        count: 0,
        timestamp: new Date().toISOString(),
      });
    }
  } catch (error) {
    console.error("Background sync error:", error);

    // Log background sync error
    await LoggingService.log({
      description: `Background sync failed: ${error.message}`,
      username: req?.session?.user?.username || "System",
      userId: req?.session?.user?.id,
      ipAddress: req?.ip,
      logType: LOG_TYPES.ERROR,
      module: MODULES.API,
      action: ACTIONS.READ,
      status: STATUS.FAILED,
      details: {
        type: "background_sync",
        error: error.message,
      },
    });

    res.status(500).json({
      success: false,
      error: {
        code: "BACKGROUND_SYNC_ERROR",
        message: error.message,
      },
      timestamp: new Date().toISOString(),
    });
  }
});

// Status check endpoint for real-time monitoring
router.post("/status-check", async (req, res) => {
  try {
    const { uuids } = req.body;

    if (!uuids || !Array.isArray(uuids) || uuids.length === 0) {
      return res.json({ success: false, message: "No UUIDs provided" });
    }

    console.log(`[Status Check] Checking status for ${uuids.length} documents`);

    const currentStatuses = await prisma.wP_INBOUND_STATUS.findMany({
      where: {
        uuid: { in: uuids },
      },
      select: {
        uuid: true,
        status: true,
        dateTimeValidated: true,
        documentStatusReason: true,
        updated_at: true,
      },
    });

    const toReconcile = currentStatuses.filter((doc) =>
      isNonTerminalInboundStatus(doc.status)
    );

    const beforeByUuid = new Map(
      currentStatuses.map((doc) => [doc.uuid, doc])
    );

    if (toReconcile.length > 0) {
      await enrichInboundDocumentsFromLhdnDetails(toReconcile, req).catch(
        (err) =>
          console.warn(
            "[Status Check] LHDN details reconcile skipped:",
            err.message
          )
      );
    }

    const afterStatuses =
      toReconcile.length > 0
        ? await prisma.wP_INBOUND_STATUS.findMany({
            where: { uuid: { in: toReconcile.map((d) => d.uuid) } },
            select: {
              uuid: true,
              status: true,
              dateTimeValidated: true,
              updated_at: true,
            },
          })
        : [];

    const changes = [];
    for (const after of afterStatuses) {
      const before = beforeByUuid.get(after.uuid);
      if (!before) continue;

      const statusChanged =
        (after.status || "").toLowerCase() !== (before.status || "").toLowerCase();
      const validatedChanged =
        (after.dateTimeValidated || null) !== (before.dateTimeValidated || null);

      if (statusChanged || validatedChanged) {
        changes.push({
          uuid: after.uuid,
          oldStatus: before.status,
          newStatus: after.status,
          oldDateTimeValidated: before.dateTimeValidated,
          newDateTimeValidated: after.dateTimeValidated,
          timestamp: after.updated_at,
        });
      }
    }

    res.json({
      success: true,
      changes,
      checkedCount: uuids.length,
      reconciledCount: toReconcile.length,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[Status Check] Error:", error);
    res.status(500).json({
      success: false,
      message: "Error checking document status",
      error: error.message,
    });
  }
});

// Export the polling function for use in other modules
module.exports = router;
module.exports.pollSubmissionStatus = pollSubmissionStatus;
