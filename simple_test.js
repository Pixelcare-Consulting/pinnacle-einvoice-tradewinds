const XLSX = require('xlsx');
const path = require('path');

console.log('Testing Excel header detection...');

// Test the smart header detection logic
const testFilePath = path.join(__dirname, 'uploads', '080925_123504.xlsx');

try {
    const workbook = XLSX.readFile(testFilePath);
    const worksheet = workbook.Sheets[workbook.SheetNames[0]];
    const range = XLSX.utils.decode_range(worksheet['!ref']);
    
    console.log('Worksheet range:', worksheet['!ref']);
    
    // Read first 3 rows
    const rows = [];
    for (let row = 0; row < Math.min(3, range.e.r + 1); row++) {
        const rowData = [];
        for (let col = range.s.c; col <= Math.min(range.e.c, 10); col++) { // Limit to first 10 columns
            const cellAddress = XLSX.utils.encode_cell({ r: row, c: col });
            const cell = worksheet[cellAddress];
            const cellValue = cell ? (cell.v || cell.w || null) : null;
            rowData.push(cellValue);
        }
        rows.push(rowData);
    }
    
    console.log('Row 0 (headers):', rows[0]);
    console.log('Row 1 (descriptions):', rows[1]);
    console.log('Row 2 (field names):', rows[2]);
    
    // Test smart header detection
    const detectBestHeaders = (rows) => {
        const headerRow = [];
        
        for (let col = 0; col < (rows[0]?.length || 0); col++) {
            let headerValue = null;
            
            // Priority 1: Use row 2 if it has meaningful field names
            if (rows[2] && rows[2][col] && String(rows[2][col]).trim() !== '') {
                const row2Value = String(rows[2][col]).trim();
                if (row2Value.includes('_') || row2Value.match(/^[A-Za-z][A-Za-z0-9_]*$/)) {
                    headerValue = row2Value;
                }
            }
            
            // Priority 2: Use row 0 if it has a non-null value
            if (!headerValue && rows[0] && rows[0][col] && String(rows[0][col]).trim() !== '') {
                headerValue = String(rows[0][col]).trim();
            }
            
            // Priority 3: Use row 1 if it has meaningful content
            if (!headerValue && rows[1] && rows[1][col] && String(rows[1][col]).trim() !== '') {
                const row1Value = String(rows[1][col]).trim();
                headerValue = row1Value.replace(/\s+/g, '_').replace(/[^A-Za-z0-9_]/g, '');
            }
            
            // Fallback: Use column index
            if (!headerValue) {
                headerValue = `__EMPTY_${col}`;
            }
            
            headerRow.push(headerValue);
        }
        
        return headerRow;
    };
    
    const smartHeaders = detectBestHeaders(rows);
    console.log('Smart headers:', smartHeaders);
    
    // Test reading with smart headers
    const rawData = XLSX.utils.sheet_to_json(worksheet, {
        raw: true,
        defval: null,
        blankrows: false,
        header: smartHeaders
    });
    
    console.log('Total rows with smart headers:', rawData.length);
    console.log('First data row keys:', Object.keys(rawData[3] || {}));
    console.log('Sample data row:', rawData[3]);
    
} catch (error) {
    console.error('Error:', error.message);
}
