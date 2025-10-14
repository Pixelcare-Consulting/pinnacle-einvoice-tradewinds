# Auto-Refresh Monitoring Fix

## Problem

The LHDN search was "repeating" even after completion because of **background monitoring intervals** that were triggering refreshes automatically.

## Root Cause

In `public/assets/js/modules/excel/inbound-excel.js`, there were two monitoring intervals running:

```javascript
// Line 946: Status monitoring - every 30 seconds
this.statusMonitorInterval = setInterval(async () => {
  await this.checkForStatusChanges();
}, 30000);

// Line 955: Submission monitoring - every 15 seconds  
this.submissionMonitorInterval = setInterval(async () => {
  await this.checkForNewSubmissions();
}, 15000);
```

### The Problem Flow:

1. User clicks "Live LHDN Data" or "Quick Refresh"
2. LHDN search starts (takes 3-4 minutes with proper rate limiting)
3. **While search is running**, background monitoring kicks in:
   - Every 15 seconds: checks for new submissions
   - Every 30 seconds: checks for status changes
4. **If changes detected**, monitoring triggers `refreshCurrentDataSource()`
5. This causes conflicting/overlapping refreshes
6. User sees "repeating" searches even when they didn't click anything

## Solution Applied

### 1. Reduced Monitoring Frequency
Changed from aggressive polling to more reasonable intervals:
- **Status monitoring**: 30s → 60s (50% reduction)
- **Submission monitoring**: 15s → 60s (75% reduction)

### 2. Added Refresh State Check
Both monitoring intervals now check if a refresh is in progress before running:

```javascript
// Monitor for status changes every 60 seconds
this.statusMonitorInterval = setInterval(async () => {
  try {
    // Skip monitoring if a refresh is already in progress
    if (this.isRefreshing) {
      console.log('⏭️ Skipping status check - refresh in progress');
      return;
    }
    await this.checkForStatusChanges();
  } catch (error) {
    console.error('❌ Status monitoring error:', error);
  }
}, 60000); // 60 seconds
```

## How It Works Now

### During Manual Refresh:
1. User clicks "Quick Refresh" or "Live LHDN Data"
2. `this.isRefreshing` is set to `true`
3. Background monitoring intervals detect `isRefreshing === true`
4. Monitoring skips checks and logs: `"⏭️ Skipping status check - refresh in progress"`
5. **No conflicting refreshes**
6. After refresh completes, `isRefreshing` is set to `false`
7. Monitoring resumes on next interval (60 seconds later)

### During Idle Time:
1. No manual refresh happening (`isRefreshing === false`)
2. Monitoring runs every 60 seconds
3. Checks for status changes or new submissions
4. If detected, triggers automatic refresh
5. User sees updated data without clicking

## Benefits

✅ **No more conflicting refreshes** - monitoring respects ongoing operations  
✅ **Reduced API load** - 60s intervals instead of 15-30s  
✅ **Better user experience** - no unexpected interruptions  
✅ **Still monitors for changes** - automatic updates still work  
✅ **Clearer logs** - shows when monitoring is skipped  

## Console Messages

You'll now see these helpful messages:

**When monitoring is skipped:**
```
⏭️ Skipping status check - refresh in progress
⏭️ Skipping submission check - refresh in progress
```

**When monitoring detects changes:**
```
📊 Detected X status changes
📢 New submission detected, refreshing inbound data...
```

## Files Modified

1. `public/assets/js/modules/excel/inbound-excel.js`
   - Updated `setupRealTimeStatusMonitoring()` method
   - Changed intervals from 15/30s to 60s
   - Added `isRefreshing` checks before monitoring

## Testing

1. **Start a manual refresh**:
   - Click "Quick Refresh" or "Live LHDN Data"
   - Open browser console
   
2. **Watch the logs**:
   - Should see: `"⏭️ Skipping status check - refresh in progress"`
   - Should NOT see duplicate refresh attempts
   
3. **Wait for completion**:
   - Refresh completes successfully
   - Monitoring resumes after 60 seconds

## Additional Notes

### Why 60 seconds?

- **LHDN rate limits**: 1 request per 5 seconds, 12 RPM
- **Search duration**: 3-4 minutes for full search
- **Monitoring conflicts**: 15-30s was too frequent
- **60s interval**: Balances responsiveness with performance

### Related Issues Fixed

- ✅ Repeating searches even when user didn't click
- ✅ Conflicting API requests during LHDN sync
- ✅ Unexpected refreshes interrupting user workflow
- ✅ Excessive API calls to backend

### Alternative Solution

If you want to **completely disable** auto-monitoring:

```javascript
setupRealTimeStatusMonitoring() {
  console.log('📋 Real-time monitoring disabled');
  // Comment out or remove all setInterval calls
  return; // Early exit
}
```

---

**Date**: October 14, 2025  
**Status**: ✅ Fixed - Monitoring now respects ongoing refreshes

