# LHDN Search Concurrency Lock - Quick Guide

## The Problem You Had

Looking at your logs:
```
2025-10-14T10:07:44: [LHDN Search] Fetching page 6 with pageSize 100
2025-10-14T10:07:44: [LHDN Search] Fetching page 9 with pageSize 100
2025-10-14T10:07:49: [LHDN Search] Fetching page 1 with pageSize 100
```

**Multiple search requests were running simultaneously** - pages 1, 6, and 9 all at the same time! This happened because:
- Multiple users clicked refresh/search at the same time, OR
- One user clicked refresh multiple times before the first request completed

This caused the LHDN API to throttle your requests with 429 errors.

## The Solution

✅ **Concurrency Lock Implemented**

Now only **ONE search can run at a time**. When a search is in progress:
- Other users get a clear message: "A search is already in progress"
- They can see who started it and how long it's been running
- They can wait and try again after it completes

## How It Works

### When User A Starts a Search:
1. Lock is acquired with requestId: `admin-1728901234567`
2. Search proceeds normally (5 seconds per page)
3. Lock is released when complete (even if there's an error)

### When User B Tries to Search (while User A's is running):
User B gets HTTP 409:
```json
{
  "success": false,
  "error": {
    "code": "SEARCH_IN_PROGRESS",
    "message": "A search operation is already in progress. Please wait for it to complete.",
    "lockedBy": "admin-1728901234567",
    "duration": 45
  }
}
```

### Checking Search Status:
Call `GET /api/lhdn/documents/search-status`:

**When search is running:**
```json
{
  "success": true,
  "searchInProgress": true,
  "lockedBy": "admin-1728901234567",
  "durationSeconds": 45
}
```

**When no search is running:**
```json
{
  "success": true,
  "searchInProgress": false
}
```

## Safety Features

1. **Auto-Release**: If a lock gets stuck (server crash, etc.), it auto-releases after 10 minutes
2. **Always Releases**: Uses `finally` block to ensure lock is released even on errors
3. **Clear Tracking**: Logs show exactly who acquired/released the lock and when

## Expected Log Output

### Normal Flow:
```
[LHDN Search] Request admin-1728901234567 - Endpoint hit
[SearchLock] Lock acquired by admin-1728901234567
[LHDN Search] Fetching Sent documents - page 1/20
[LHDN Search] Fetching Sent documents - page 2/20
...
[LHDN Search] Total documents fetched: 1234
[SearchLock] Lock released by admin-1728901234567 after 98234ms
```

### When Concurrent Request Blocked:
```
[LHDN Search] Request jane-1728901500000 - Endpoint hit
[LHDN Search] Request jane-1728901500000 - Search already in progress by admin-1728901234567 (45s)
```

## Frontend Integration (Recommended)

You should update your frontend to:

1. **Check status before starting search:**
   ```javascript
   const status = await fetch('/api/lhdn/documents/search-status');
   if (status.searchInProgress) {
     alert(`Search in progress (${status.durationSeconds}s). Please wait...`);
     return;
   }
   ```

2. **Handle 409 errors gracefully:**
   ```javascript
   try {
     const result = await fetch('/api/lhdn/documents/search');
   } catch (error) {
     if (error.status === 409) {
       alert('A search is already in progress. Please wait...');
     }
   }
   ```

3. **Disable search button while in progress:**
   - Poll the status endpoint every 5 seconds
   - Disable button if `searchInProgress === true`
   - Show progress message

## What Changed

**Files Modified:**
- `routes/api/lhdn.js` - Added lock mechanism, status endpoint
- `services/lhdn/lhdnService.js` - Fixed rate limiting (5s between requests)
- `LHDN_SEARCH_API_OPTIMIZATION.md` - Full documentation

**New Endpoints:**
- `GET /api/lhdn/documents/search-status` - Check if search is running

**Behavior:**
- Only 1 search at a time
- 5 seconds between API requests (LHDN requirement)
- Max 20 pages per direction (40 total requests)
- ~3-4 minutes for full search
- No more concurrent requests overwhelming the API

## Summary

✅ **Problem Solved**: Multiple concurrent searches causing rate limit errors  
✅ **Solution**: Concurrency lock + proper rate limiting (5s per request)  
✅ **Protection**: Auto-release after 10 minutes if stuck  
✅ **User Experience**: Clear 409 error with helpful message  
✅ **Monitoring**: Status endpoint to check if search is running  

Your logs will now show sequential page fetches (1, 2, 3...) instead of concurrent ones (1, 6, 9 at the same time).

---

**Date**: October 14, 2025  
**Status**: ✅ Implemented and tested

