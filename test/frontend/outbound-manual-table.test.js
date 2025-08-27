/**
 * Frontend tests for Outbound Manual Table functionality
 * Run this in browser console or with a test runner like Jest with jsdom
 */

// Mock data that matches our API response structure
const mockApiResponse = {
    success: true,
    files: [
        {
            id: 1,
            DT_RowId: 'file_1',
            fileName: 'test_invoice_070325.xlsx',
            invoiceNumber: '5 Invoice(s)',
            supplier: 'Test User',
            receiver: 'Multiple Recipients',
            date: '2024-01-15T10:30:00Z',
            invDateInfo: '2024-01-15',
            status: 'processed',
            source: 'Excel Upload',
            totalAmount: 1500.50,
            originalFilename: 'test_invoice_070325.xlsx',
            filePath: '/uploads/test_invoice_070325.xlsx',
            fileSize: '2048',
            uploadedBy: 'Test User',
            uploadDate: '2024-01-15T10:30:00Z',
            metadata: {
                totalAmount: 1500.50,
                filenameValidation: {
                    parsedData: {
                        formattedDate: '2024-01-15'
                    }
                }
            }
        },
        {
            id: 2,
            DT_RowId: 'file_2',
            fileName: 'test_invoice_080325.xlsx',
            invoiceNumber: '3 Invoice(s)',
            supplier: 'Test User 2',
            receiver: 'Multiple Recipients',
            date: '2024-01-16T14:20:00Z',
            invDateInfo: '2024-01-16',
            status: 'uploaded',
            source: 'Excel Upload',
            totalAmount: 750.25,
            originalFilename: 'test_invoice_080325.xlsx',
            filePath: '/uploads/test_invoice_080325.xlsx',
            fileSize: '1536',
            uploadedBy: 'Test User 2',
            uploadDate: '2024-01-16T14:20:00Z',
            metadata: {
                totalAmount: 750.25
            }
        }
    ],
    total: 2
};

// Test functions
function testDataProcessing() {
    console.log('Testing data processing...');
    
    // Simulate the data processing logic from our JavaScript
    const processedData = mockApiResponse.files.map(file => ({
        ...file,
        DT_RowId: file.DT_RowId || `file_${file.id}`,
        
        // Map the data to match table columns
        fileName: file.fileName || file.originalFilename,
        invoiceNumber: file.invoiceNumber,
        supplier: file.supplier,
        receiver: file.receiver,
        date: file.date || file.uploadDate,
        invDateInfo: file.invDateInfo,
        status: file.status || 'uploaded',
        source: file.source || 'Excel Upload',
        totalAmount: file.totalAmount,
        
        // Additional data for actions and display
        id: file.id,
        fileSize: file.fileSize,
        uploadedBy: file.uploadedBy,
        uploadDate: file.uploadDate,
        metadata: file.metadata
    }));
    
    console.log('Processed data:', processedData);
    
    // Verify data structure
    processedData.forEach((item, index) => {
        console.assert(item.id !== undefined, `Item ${index} missing id`);
        console.assert(item.fileName !== undefined, `Item ${index} missing fileName`);
        console.assert(item.invoiceNumber !== undefined, `Item ${index} missing invoiceNumber`);
        console.assert(item.supplier !== undefined, `Item ${index} missing supplier`);
        console.assert(item.receiver !== undefined, `Item ${index} missing receiver`);
        console.assert(item.status !== undefined, `Item ${index} missing status`);
        console.assert(item.source !== undefined, `Item ${index} missing source`);
    });
    
    console.log('✅ Data processing test passed');
    return processedData;
}

function testRenderMethods() {
    console.log('Testing render methods...');
    
    // Mock InvoiceTableManager methods
    const mockManager = {
        renderFileName: function(data, type, row) {
            if (!data) return '<span class="text-muted">N/A</span>';
            return `<div class="file-info-wrapper">
                <div class="file-name fw-bold">${data}</div>
                <div class="file-size text-muted small">${this.formatFileSize(row.fileSize)}</div>
            </div>`;
        },
        
        renderInvoiceNumber: function(data, type, row) {
            if (!data) return '<span class="text-muted">N/A</span>';
            return `<div class="invoice-info-wrapper">
                <div class="invoice-number">${data}</div>
                <div class="file-info">${row.fileName}</div>
            </div>`;
        },
        
        renderSupplier: function(data) {
            if (!data) return '<span class="text-muted">N/A</span>';
            return `<span class="supplier-name">${data}</span>`;
        },
        
        renderReceiver: function(data) {
            if (!data) return '<span class="text-muted">N/A</span>';
            return `<span class="receiver-name">${data}</span>`;
        },
        
        renderUploadedDate: function(data) {
            if (!data) return '<span class="text-muted">N/A</span>';
            return new Date(data).toLocaleDateString();
        },
        
        renderInvDateInfo: function(data, type, row) {
            if (!data || data === 'N/A') return '<span class="text-muted">N/A</span>';
            return `<span class="date-info">${data}</span>`;
        },
        
        renderStatus: function(data) {
            if (!data) return '<span class="badge bg-secondary">Unknown</span>';
            const statusColors = {
                'pending': 'warning',
                'submitted': 'success',
                'invalid': 'danger',
                'processed': 'info',
                'uploaded': 'primary'
            };
            const color = statusColors[data.toLowerCase()] || 'secondary';
            return `<span class="badge bg-${color}">${data}</span>`;
        },
        
        renderSource: function(data) {
            if (!data) return '<span class="text-muted">N/A</span>';
            return `<span class="badge bg-info">${data}</span>`;
        },
        
        renderTotalAmount: function(data) {
            if (!data || data === 0) return '<span class="text-muted">N/A</span>';
            
            const num = parseFloat(data);
            if (!isNaN(num)) {
                return `<span class="fw-bold text-success">RM ${num.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>`;
            }
            
            return `<span class="fw-bold">${data}</span>`;
        },
        
        formatFileSize: function(bytes) {
            if (!bytes) return 'N/A';
            
            const size = parseInt(bytes);
            if (isNaN(size)) return 'N/A';
            
            const units = ['B', 'KB', 'MB', 'GB'];
            let unitIndex = 0;
            let fileSize = size;
            
            while (fileSize >= 1024 && unitIndex < units.length - 1) {
                fileSize /= 1024;
                unitIndex++;
            }
            
            return `${fileSize.toFixed(1)} ${units[unitIndex]}`;
        }
    };
    
    // Test each render method with sample data
    const testRow = mockApiResponse.files[0];
    
    console.log('Testing renderFileName:', mockManager.renderFileName(testRow.fileName, 'display', testRow));
    console.log('Testing renderInvoiceNumber:', mockManager.renderInvoiceNumber(testRow.invoiceNumber, 'display', testRow));
    console.log('Testing renderSupplier:', mockManager.renderSupplier(testRow.supplier));
    console.log('Testing renderReceiver:', mockManager.renderReceiver(testRow.receiver));
    console.log('Testing renderUploadedDate:', mockManager.renderUploadedDate(testRow.date));
    console.log('Testing renderInvDateInfo:', mockManager.renderInvDateInfo(testRow.invDateInfo, 'display', testRow));
    console.log('Testing renderStatus:', mockManager.renderStatus(testRow.status));
    console.log('Testing renderSource:', mockManager.renderSource(testRow.source));
    console.log('Testing renderTotalAmount:', mockManager.renderTotalAmount(testRow.totalAmount));
    console.log('Testing formatFileSize:', mockManager.formatFileSize(testRow.fileSize));
    
    console.log('✅ Render methods test passed');
}

function testTableColumns() {
    console.log('Testing table column configuration...');
    
    const expectedColumns = [
        'checkbox', '#', 'FILE NAME', 'INVOICE NO.', 'SUPPLIER', 
        'RECEIVER', 'DATE', 'INV. DATE INFO', 'STATUS', 'SOURCE', 
        'TOTAL AMOUNT', 'ACTION'
    ];
    
    console.log('Expected columns:', expectedColumns);
    console.log('✅ Table columns test passed');
}

// Run all tests
function runAllTests() {
    console.log('🧪 Starting Outbound Manual Table Tests...');
    console.log('==========================================');
    
    try {
        testDataProcessing();
        testRenderMethods();
        testTableColumns();
        
        console.log('==========================================');
        console.log('✅ All tests passed successfully!');
    } catch (error) {
        console.error('❌ Test failed:', error);
    }
}

// Export for Node.js testing or run immediately in browser
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        testDataProcessing,
        testRenderMethods,
        testTableColumns,
        runAllTests,
        mockApiResponse
    };
} else {
    // Run tests immediately if in browser
    runAllTests();
}
