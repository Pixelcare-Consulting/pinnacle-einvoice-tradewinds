# NULL Fields After Quick Refresh - Root Cause and Fix

## Problem
After clicking "Quick Refresh", the following fields were showing as NULL or missing in the database:
- `issuerTin`
- `issuerName`
- `receiverId`
- `receiverName`
- `totalSales` (showing as N/A)
- `totalPayableAmount`
- Other financial fields

## Root Cause Analysis

### Investigation Steps
1. Identified that "Quick Refresh" button calls `refreshCurrentDataSource()` in the frontend
2. Frontend performs incremental refresh by calling `/api/lhdn/documents/search` endpoint
3. Backend endpoint calls `searchDocuments()` from `lhdnService` to fetch from LHDN API
4. **FOUND THE BUG**: The mapping code in `/documents/search` endpoint was not handling alternative field names

### The Bug
In `routes/api/lhdn.js` at lines 2194-2197, the code was:

```javascript
issuerTin: doc.issuerTin || null,
issuerName: doc.issuerName || null,
receiverId: doc.receiverId || null,
receiverName: doc.receiverName || null,
totalSales: doc.totalSales ? parseFloat(doc.totalSales) : null,
```

**Problem**: The LHDN Search API returns documents with different field names:
- Uses `supplierName` instead of `issuerName`
- Uses `supplierTIN` (uppercase TIN!) instead of `issuerTin`
- Uses `buyerName` instead of `receiverName`
- Uses `buyerTIN` and `receiverID` (uppercase!) instead of `receiverId`
- **Does NOT return `totalSales`, `total`, or `netAmount` fields!**
- Only returns: `totalPayableAmount`, `totalExcludingTax`, `totalNetAmount`, `totalDiscount`

The mapping code was NOT checking for these alternative names or handling the missing totalSales field, so fields were being set to `null` or `0` in the database.

## The Fix

Updated the field mapping in `/documents/search` endpoint (lines 2184-2238) to include fallbacks:

### Party Field Mapping:
```javascript
// Map issuerTin with fallbacks (API returns supplierTIN with uppercase TIN!)
issuerTin: doc.issuerTin || doc.issuerTIN || doc.supplierTin || doc.supplierTIN || doc.issuerID || null,

// Map issuerName with fallback to supplierName
issuerName: doc.issuerName || doc.supplierName || null,

// Map receiverId with fallbacks (API returns buyerTIN and receiverID with uppercase!)
receiverId: doc.receiverId || doc.receiverID || doc.buyerTin || doc.buyerTIN || null,

// Map receiverName with fallback to buyerName
receiverName: doc.receiverName || doc.buyerName || null,
```

### Financial Field Mapping:
```javascript
// CRITICAL: LHDN Search API doesn't return totalSales/total/netAmount!
// It only returns: totalPayableAmount, totalExcludingTax, totalNetAmount, totalDiscount
// Use totalPayableAmount as the main total (this is what should be displayed)
totalSales: parseFloat(doc.totalPayableAmount || doc.totalSales || doc.total || 0),
totalExcludingTax: parseFloat(doc.totalExcludingTax || doc.taxExclusiveAmount || 0),
totalDiscount: parseFloat(doc.totalDiscount || doc.discount || 0),
totalNetAmount: parseFloat(doc.totalNetAmount || doc.netAmount || 0),
totalPayableAmount: parseFloat(doc.totalPayableAmount || doc.payableAmount || doc.total || 0),
documentCurrency: doc.documentCurrency || doc.currency || doc.currencyCode || 'MYR',
```

**Key Discovery**: The LHDN Search API returns `totalPayableAmount` but NOT `totalSales`. We now map `totalPayableAmount` → `totalSales` for display purposes.

Also added comprehensive logging to help debug future issues:
- Logs the first document's available fields
- Shows which party-related fields are present in the API response
- Shows which financial fields are present in the API response
- Lists all field names containing: issuer, supplier, receiver, buyer, total, amount, sales, payable
- This will help identify if the LHDN API changes field names again

## Additional Findings

### Multiple Duplicate Endpoints
Found THREE duplicate `/documents/refresh` endpoints in `lhdn.js`:
1. Line 1612 - Uses `fetchRecentDocuments()`
2. Line 3451 - Uses `fetchRecentDocuments()`  
3. Line 5848 - Has its own implementation with inline axios calls

**Recommendation**: These should be consolidated into a single endpoint to avoid confusion and potential bugs.

### Enhanced Logging
Added logging at line 5925 in the third refresh endpoint to show what fields are actually returned by the LHDN API.

## Testing Instructions

1. **Restart your application** to load the updated code
2. Click the **"Quick Refresh"** button in the UI
3. Check the console logs for:
   ```
   [LHDN Search] Sample document fields: { ... }
   ```
4. Query the database to verify the fields are no longer NULL:
   ```sql
   SELECT TOP 10 
     uuid, 
     issuerTin, 
     issuerName, 
     receiverId, 
     receiverName, 
     dateTimeReceived
   FROM WP_INBOUND_STATUS
   ORDER BY dateTimeReceived DESC
   ```

## Expected Results
- ✅ `issuerName` should contain supplier company names (not NULL)
- ✅ `issuerTin` should contain supplier TIN numbers (not NULL)
- ✅ `receiverName` should contain buyer company names (not NULL)
- ✅ `receiverId` should contain buyer TIN numbers (not NULL)
- ✅ `totalSales` should contain invoice total amounts (not NULL or 0)
- ✅ `totalPayableAmount` should contain payable amounts (not NULL or 0)
- ✅ Other financial fields should be populated correctly

## Files Modified
- `routes/api/lhdn.js` (lines 2184-2238 and 5923-5964)
  - Added party field mapping with fallbacks (issuer/supplier, receiver/buyer)
  - Added financial field mapping with fallbacks (totalSales/total, totalPayableAmount/payableAmount, etc.)
  - Enhanced logging to show available fields in API response

## Notes
- This fix applies to the "Quick Refresh" functionality that uses the LHDN Search API
- **Party Field Handling:**
  - Handles both `supplierName`/`supplierTIN` AND `issuerName`/`issuerTIN` field naming
  - Handles both `buyerName`/`buyerTIN` AND `receiverName`/`receiverID` field naming
  - **Important**: Field names use UPPERCASE for TIN/ID: `supplierTIN`, `buyerTIN`, `receiverID`, `issuerTIN`
- **Financial Field Handling:**
  - **Critical Discovery**: LHDN Search API does NOT return `totalSales`, `total`, or `netAmount`
  - API only returns: `totalPayableAmount`, `totalExcludingTax`, `totalNetAmount`, `totalDiscount`
  - Maps `totalPayableAmount` → `totalSales` (for UI display)
  - Maps `totalPayableAmount` → `totalPayableAmount` (for storage)
  - Defaults currency to 'MYR' if not specified
- The logging will help identify if LHDN changes their API field names in the future
- All financial values are parsed as floats and default to 0 if missing
- **Reference**: [MyInvois Search Documents API Documentation](https://sdk.myinvois.hasil.gov.my/einvoicingapi/09-search-documents/)

