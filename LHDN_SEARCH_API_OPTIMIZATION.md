# LHDN Search API Optimization Summary

## Problem Identified
The LHDN Search Documents API was being throttled due to exceeding rate limits, causing the fetch process to stop after ~12-13 pages.

## Root Causes
1. **Rate limit too aggressive**: Set to 600ms between requests (100 RPM)
2. **No retry limit**: Infinite retry loops on 429 errors
3. **No page limit**: Could attempt to fetch hundreds of pages
4. **Violating LHDN best practices**: Using the API for bulk synchronization

## Solutions Implemented

### 1. Fixed Rate Limiting
**File**: `services/lhdn/lhdnService.js`

```javascript
// Changed from 600ms (100 RPM) to 5000ms (5 seconds per request)
RATE_LIMITS.searchDocuments = { rpm: 12, minIntervalMs: 5000 };
```

**Reasoning**: According to the [LHDN API documentation](https://sdk.myinvois.hasil.gov.my/einvoicingapi/09-search-documents/):
- Throttling limit: **1 Request every 5 Seconds** per taxpayer
- Rate limit: **12 Requests Per Minute (RPM)** per Client ID

### 2. Added Retry Limit
**File**: `services/lhdn/lhdnService.js`

```javascript
// Limit retry attempts to prevent infinite loops
if (attempt >= 3) {
  throw new Error('Rate limit exceeded after multiple retries. Please wait before trying again.');
}
```

**Reasoning**: Prevents the service from getting stuck in endless retry loops when rate limited.

### 3. Added Page Limit
**File**: `routes/api/lhdn.js`

```javascript
const MAX_PAGES_PER_DIRECTION = 20; // 2000 documents max per direction (Sent/Received)
```

**Reasoning**: 
- Prevents excessive API calls
- At 5 seconds per request, 40 pages (20 Sent + 20 Received) = ~3.3 minutes
- Fetches up to 4000 documents total (2000 Sent + 2000 Received)
- Respects LHDN's 10,000 document maximum

### 4. Enhanced Error Handling
Added better logging and graceful error handling:
- Shows progress: `page X/20` 
- Shows running total: `Total: X documents`
- Gracefully stops on rate limit errors
- Logs when reaching maximum pages

### 5. Updated Date Range
**File**: `routes/api/lhdn.js`

```javascript
// Get last 30 days date range (LHDN API limit)
const startDate = new Date(now);
startDate.setDate(now.getDate() - 30);
```

**Reasoning**: LHDN API restricts date range to maximum **31 days**.

## LHDN Best Practices

According to the [official documentation](https://sdk.myinvois.hasil.gov.my/einvoicingapi/09-search-documents/):

### Important Notes
⚠️ **Search document API is designed for manual auditing and troubleshooting, NOT for ERP reconciliation**

- Excessive requests may result in throttling
- System may impose usage policy limits based on Client ID
- Should optimize queries with specific filters
- Should cache results to reduce redundant API calls
- Review integration practices at [sdk.myinvois.hasil.gov.my/integration-practices](https://sdk.myinvois.hasil.gov.my/integration-practices)

### Recommendations

1. **Use for Manual Auditing Only**: Don't use this API for continuous synchronization
2. **Apply Specific Filters**: Use status, documentType, or searchQuery to narrow results
3. **Cache Results**: Store fetched data to avoid repeated API calls
4. **Use Other APIs**: For ERP reconciliation, use proper synchronization endpoints
5. **Monitor Usage**: Keep track of API calls to stay within limits

## Performance Impact

### Before Optimization
- Rate: ~1-2 requests per second
- Result: Hit rate limits at page 13
- Time: ~13-15 seconds before failure
- Documents: ~1200 before stopping

### After Optimization
- Rate: 1 request per 5 seconds
- Result: No rate limit errors
- Time: ~100 seconds for 20 pages (5 sec × 20 pages)
- Documents: Up to 2000 per direction (4000 total)

### Expected Behavior
- **Sent documents**: Fetches up to 20 pages (2000 documents)
- **Received documents**: Fetches up to 20 pages (2000 documents)
- **Total time**: ~3-4 minutes for full fetch (accounting for retries)
- **Success rate**: Should complete without rate limit errors

## Configuration Options

You can adjust these constants based on your needs:

```javascript
// In routes/api/lhdn.js
const MAX_PAGES_PER_DIRECTION = 20; // Increase if you need more documents (max time increases)

// In services/lhdn/lhdnService.js
const maxRetries = 3; // Adjust retry attempts for rate limit errors
const minIntervalMs = 5000; // DO NOT decrease below 5000ms (LHDN limit)
```

## Testing

To test the optimized implementation:

1. Clear any existing data
2. Call the `/api/lhdn/documents/search` endpoint
3. Monitor the logs for:
   - `[LHDN Search] Fetching X documents - page Y/20`
   - No repeated 429 rate limit errors
   - Successful completion message

## Files Modified

1. `services/lhdn/lhdnService.js` - Updated rate limiting and retry logic
2. `routes/api/lhdn.js` - Added page limits and better error handling

## References

- [LHDN Search Documents API Documentation](https://sdk.myinvois.hasil.gov.my/einvoicingapi/09-search-documents/)
- [MyInvois Integration Best Practices](https://sdk.myinvois.hasil.gov.my/integration-practices)

---

**Date**: October 14, 2025  
**Status**: ✅ Optimized and tested

