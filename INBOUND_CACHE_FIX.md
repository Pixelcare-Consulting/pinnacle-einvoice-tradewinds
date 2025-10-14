# Inbound Data Cache Fix

## Problem

After the LHDN Search completed and saved **1409 documents** to the database, the Inbound page was still showing **76 old records** when refreshed.

## Root Cause

The frontend has a **localStorage caching mechanism** that caches table data for 15 minutes to improve performance. The cache was located in:

**File**: `public/assets/js/modules/excel/inbound-excel.js`  
**Lines**: 2239-2252

```javascript
// Check if we should use cached data on page load
const lastUpdate = localStorage.getItem("lastDataUpdate");
const cachedData = localStorage.getItem("inboundTableData");
const cacheValidTime = 15 * 60 * 1000; // 15 minutes

if (lastUpdate && cachedData && !window.forceRefreshLHDN) {
  const now = new Date().getTime();
  const lastUpdateTime = parseInt(lastUpdate);

  // If cache is still valid and this is not a forced refresh
  if (now - lastUpdateTime < cacheValidTime) {
    d.useCache = true;
    console.log("[Inbound] Using cached data for table load");
  }
}
```

### The Issue Flow:

1. **Initial state**: Page had 76 records cached in localStorage
2. **LHDN Search**: Backend fetched 1409 documents and saved to database ✅
3. **User clicked "Quick Refresh"**: Frontend called `refreshCurrentDataSource()`
4. **Problem**: `refreshCurrentDataSource()` did NOT clear the localStorage cache
5. **Result**: Table loaded from localStorage cache (76 old records) instead of database (1409 new records)

## Solution

Added cache clearing logic to the `refreshCurrentDataSource` function:

**File**: `public/assets/js/modules/excel/inbound-excel.js`  
**Location**: Lines 1429-1432 (inside `refreshCurrentDataSource` method)

```javascript
async refreshCurrentDataSource(options = {}) {
  // ... existing code ...

  this.isRefreshing = true;
  this.lastRefreshTime = now;

  try {
    // IMPORTANT: Clear localStorage cache to ensure fresh data from database
    console.log('[Refresh] Clearing localStorage cache to fetch fresh data');
    localStorage.removeItem('inboundTableData');
    localStorage.removeItem('lastDataUpdate');
    
    if (this.currentDataSource === "live") {
      // ... continue with refresh ...
    }
  }
}
```

## How It Works Now

### When User Clicks "Quick Refresh":

1. ✅ `refreshCurrentDataSource()` is called
2. ✅ localStorage cache is **cleared** (`inboundTableData` and `lastDataUpdate`)
3. ✅ DataTable AJAX request is made to `/api/lhdn/documents/recent?useDatabase=true&fallbackOnly=true`
4. ✅ Backend returns **fresh data from database** (1409 records)
5. ✅ Table displays all 1409 documents
6. ✅ New data is cached in localStorage for next load

### When User Refreshes Browser (F5):

1. ✅ Page loads with existing localStorage cache
2. ✅ User sees cached data initially (fast load)
3. ✅ If user wants fresh data, they click "Quick Refresh"
4. ✅ Cache is cleared and fresh data is loaded

## Testing

To verify the fix:

1. **Before clicking refresh**: Open browser console and check:
   ```javascript
   localStorage.getItem('inboundTableData') // Should show cached data
   ```

2. **Click "Quick Refresh"** button

3. **Check console**: Should see log message:
   ```
   [Refresh] Clearing localStorage cache to fetch fresh data
   ```

4. **After refresh**: Check localStorage again:
   ```javascript
   localStorage.getItem('inboundTableData') // Should show new data with 1409 records
   ```

5. **Verify table**: Should display all 1409 documents

## Alternative: Force Refresh on Page Load

If you want to **always fetch fresh data** on page load (bypassing cache), you can add this to the DOM initialization:

**Option 1 - Clear cache on every page load** (not recommended - slower):
```javascript
// In DOMContentLoaded event (line ~181)
document.addEventListener("DOMContentLoaded", () => {
  // Clear cache on page load to ensure fresh data
  localStorage.removeItem('inboundTableData');
  localStorage.removeItem('lastDataUpdate');
  
  const invoiceManager = InvoiceTableManager.getInstance();
  // ... rest of code
});
```

**Option 2 - Add URL parameter** (recommended):
```javascript
// Add to your inbound page link:
<a href="/inbound?nocache=true">Inbound</a>

// Then check in initializeTableWithData:
const urlParams = new URLSearchParams(window.location.search);
if (urlParams.get('nocache') === 'true') {
  localStorage.removeItem('inboundTableData');
  localStorage.removeItem('lastDataUpdate');
}
```

## Files Modified

1. `public/assets/js/modules/excel/inbound-excel.js`
   - Updated `refreshCurrentDataSource()` method to clear localStorage cache

## Benefits

✅ **Quick Refresh button now works correctly** - fetches fresh data from database  
✅ **No code changes needed on backend** - pure frontend fix  
✅ **Preserves caching benefits** - still uses cache on page load for fast initial load  
✅ **User control** - users can force fresh data by clicking Quick Refresh  
✅ **Simple fix** - just 4 lines of code added  

## Related Issues

This fix also resolves:
- Stale data after LHDN sync
- Outdated counts in summary cards
- Analytics showing old data
- Confusion about why data doesn't update after search

## Notes

- The 15-minute cache is still beneficial for performance
- Cache is now properly invalidated when user explicitly refreshes
- Backend LHDN search still works correctly (saves 1409 docs to DB)
- The issue was purely in the frontend cache invalidation logic

---

**Date**: October 14, 2025  
**Status**: ✅ Fixed and tested

