# Testing Documentation for Outbound Manual Feature

## Overview

This directory contains comprehensive tests for the Outbound Manual feature, specifically focusing on the table display functionality for `WP_UPLOADED_EXCEL_FILES`.

## Test Files

### 1. `verify-implementation.js`
**Purpose**: Static code verification without requiring a running server
**Usage**: `pnpm run verify`

This script checks:
- ✅ File existence and syntax
- ✅ API endpoint structure
- ✅ Frontend JavaScript implementation
- ✅ HTML template structure
- ✅ Required functionality presence

### 2. `api/outbound-manual-api.test.js`
**Purpose**: Unit tests for the API endpoint
**Usage**: `pnpm run test:api`

Tests:
- API endpoint authentication
- Data structure validation
- Error handling
- Database interaction

### 3. `frontend/outbound-manual-table.test.js`
**Purpose**: Frontend JavaScript logic testing
**Usage**: `pnpm run test:frontend`

Tests:
- Data processing logic
- Render methods functionality
- Table column configuration
- Mock data handling

### 4. `integration/test-outbound-manual.js`
**Purpose**: Integration testing with running server
**Usage**: `pnpm run test:outbound-manual`

Tests:
- Server connectivity
- API endpoint accessibility
- Static file serving
- End-to-end functionality

## Quick Testing Workflow

### Before Deployment (Recommended)

1. **Verify Implementation**
   ```bash
   pnpm run verify
   ```
   This ensures all code is syntactically correct and contains required functionality.

2. **Test Frontend Logic**
   ```bash
   pnpm run test:frontend
   ```
   Validates JavaScript logic without server dependency.

3. **Start Server and Test Integration**
   ```bash
   # Terminal 1
   pnpm start
   
   # Terminal 2
   pnpm run test:outbound-manual
   ```

### Manual Testing Steps

After automated tests pass:

1. **Start the application**
   ```bash
   pnpm start
   ```

2. **Navigate to Outbound Manual page**
   - Login to the application
   - Go to `/dashboard/outbound-manual`

3. **Verify table functionality**
   - Check if table loads with correct headers
   - Verify data displays from `WP_UPLOADED_EXCEL_FILES`
   - Test file upload functionality
   - Verify table refresh after upload

## Expected Table Structure

The table should display the following columns:
- ☑️ Checkbox (for bulk operations)
- \# (Row number)
- FILE NAME (with file size)
- INVOICE NO. (invoice count)
- SUPPLIER (uploaded by user)
- RECEIVER (typically "Multiple Recipients")
- DATE (upload date)
- INV. DATE INFO (parsed from filename)
- STATUS (processing status)
- SOURCE ("Excel Upload")
- TOTAL AMOUNT (formatted currency)
- ACTION (view, submit, delete buttons)

## API Endpoint

**URL**: `/api/outbound-files-manual/list-fixed-paths`
**Method**: GET
**Authentication**: Required
**Response Format**:
```json
{
  "success": true,
  "files": [
    {
      "id": 1,
      "DT_RowId": "file_1",
      "fileName": "example.xlsx",
      "invoiceNumber": "5 Invoice(s)",
      "supplier": "User Name",
      "receiver": "Multiple Recipients",
      "date": "2024-01-15T10:30:00Z",
      "invDateInfo": "2024-01-15",
      "status": "processed",
      "source": "Excel Upload",
      "totalAmount": 1500.50,
      "fileSize": "2048",
      "metadata": {...}
    }
  ],
  "total": 1
}
```

## Troubleshooting

### Common Issues

1. **Server returns 302 redirect**
   - This is expected for unauthenticated requests
   - The application requires login

2. **Table not loading data**
   - Check browser console for JavaScript errors
   - Verify API endpoint is accessible
   - Check authentication status

3. **Render methods not working**
   - Verify all render methods are defined
   - Check for JavaScript syntax errors
   - Ensure data structure matches expectations

### Debug Commands

```bash
# Check syntax
node -c routes/api/outbound-manual.routes.js
node -c public/assets/js/modules/excel/outbound-manual.js

# Run verification
pnpm run verify

# Check server logs
pnpm start
```

## Success Criteria

✅ All verification checks pass
✅ No JavaScript syntax errors
✅ API endpoint responds correctly
✅ Table displays with correct headers
✅ Data loads from WP_UPLOADED_EXCEL_FILES
✅ File upload refreshes table
✅ Actions (view, submit, delete) work correctly

## Notes

- Tests are designed to be run before deployment
- Integration tests require a running server
- Frontend tests can run independently
- Verification script provides comprehensive static analysis
