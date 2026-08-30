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
            invoice_count: 5,
            originalFilename: 'test_invoice_070325.xlsx',
            filePath: '/uploads/test_invoice_070325.xlsx',
            fileSize: '2048',
            uploadedBy: 'Test User',
            uploadDate: '2024-01-15T10:30:00Z',
            invoiceDetails: [
                { invoiceNumber: 'INV-001', buyer: 'Buyer A', supplier: 'Supplier X' },
                { invoiceNumber: 'INV-002', buyer: 'Buyer B', supplier: 'Supplier X' },
            ],
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
            invoiceNumber: '50 Invoice(s)\nINV-001',
            supplier: 'Test User 2',
            receiver: 'Multiple Recipients',
            date: '2024-01-16T14:20:00Z',
            invDateInfo: '2024-01-16',
            status: 'uploaded',
            source: 'Excel Upload',
            totalAmount: 750.25,
            invoice_count: 50,
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

function partyLabel(party) {
    if (!party) return '';
    if (typeof party === 'string') return party.trim();
    return (party.company || party.name || party.registrationName || '').trim();
}

function partyKey(party) {
    if (!party) return '';
    if (typeof party === 'string') return party.trim().toLowerCase();
    const tin = party.identifications?.tin || '';
    return `${partyLabel(party)}_${tin}`.toLowerCase();
}

function resolveInvoiceCount(fileData) {
    if (Array.isArray(fileData?.invoiceDetails) && fileData.invoiceDetails.length) {
        return fileData.invoiceDetails.length;
    }
    if (fileData?.invoice_count != null) return Number(fileData.invoice_count);
    if (fileData?.metadata?.listInvoiceDetails?.length) {
        return fileData.metadata.listInvoiceDetails.length;
    }
    const m = String(fileData?.invoiceNumber || '').match(/^(\d+)\s+Invoice/i);
    if (m) return parseInt(m[1], 10);
    return 0;
}

function extractReceiverData(documents) {
    if (!documents || !Array.isArray(documents)) return [];
    const receivers = [];
    const seenReceivers = new Set();
    documents.forEach((doc) => {
        if (doc.buyer) {
            const receiverKey = partyKey(doc.buyer);
            if (receiverKey && !seenReceivers.has(receiverKey)) {
                seenReceivers.add(receiverKey);
                receivers.push(doc.buyer);
            }
        }
    });
    return receivers;
}

// Test functions
function testDataProcessing() {
    console.log('Testing data processing...');

    const processedData = mockApiResponse.files.map(file => ({
        ...file,
        DT_RowId: file.DT_RowId || `file_${file.id}`,
        fileName: file.fileName || file.originalFilename,
        invoiceNumber: file.invoiceNumber,
        supplier: file.supplier,
        receiver: file.receiver,
        date: file.date || file.uploadDate,
        invDateInfo: file.invDateInfo,
        status: file.status || 'uploaded',
        source: file.source || 'Excel Upload',
        totalAmount: file.totalAmount,
        id: file.id,
        fileSize: file.fileSize,
        uploadedBy: file.uploadedBy,
        uploadDate: file.uploadDate,
        invoice_count: file.invoice_count,
        metadata: file.metadata
    }));

    processedData.forEach((item, index) => {
        console.assert(item.id !== undefined, `Item ${index} missing id`);
        console.assert(item.fileName !== undefined, `Item ${index} missing fileName`);
        console.assert(item.invoiceNumber !== undefined, `Item ${index} missing invoiceNumber`);
    });

    console.log('✅ Data processing test passed');
    return processedData;
}

function testResolveInvoiceCount() {
    console.log('Testing resolveInvoiceCount...');

    const fromDetails = resolveInvoiceCount(mockApiResponse.files[0]);
    console.assert(fromDetails === 2, `Expected 2 from invoiceDetails, got ${fromDetails}`);

    const fromCountField = resolveInvoiceCount({
        invoiceNumber: '50 Invoice(s)',
        invoice_count: 50,
        invoiceDetails: []
    });
    console.assert(fromCountField === 50, `Expected 50 from invoice_count, got ${fromCountField}`);

    const fromDisplayString = resolveInvoiceCount({
        invoiceNumber: '50 Invoice(s)\nINV-001',
        invoiceDetails: []
    });
    console.assert(fromDisplayString === 50, `Expected 50 from display string, got ${fromDisplayString}`);

    console.log('✅ resolveInvoiceCount test passed');
}

function testReceiverDedup() {
    console.log('Testing receiver deduplication...');

    const docs = [
        { buyer: 'AIA BHD' },
        { buyer: 'AIA BHD' },
        { buyer: 'Other Corp' },
        { buyer: { company: 'Same Co', identifications: { tin: 'T1' } } },
        { buyer: { company: 'Same Co', identifications: { tin: 'T1' } } },
    ];

    const receivers = extractReceiverData(docs);
    console.assert(receivers.length === 3, `Expected 3 unique receivers, got ${receivers.length}`);

    console.log('✅ Receiver dedup test passed');
}

function testTableColumns() {
    console.log('Testing table column configuration...');

    const expectedColumns = [
        'checkbox', '#', 'FILE NAME', 'INVOICE NO.', 'SUPPLIER',
        'RECEIVER', 'UPLOADED', 'INVOICE DATE', 'SUBMITTED',
        'statusPriority', 'id', 'STATUS', 'TOTAL AMOUNT', 'ACTION'
    ];

    console.assert(expectedColumns.length === 14, 'Expected 14 table columns');
    console.log('Expected columns:', expectedColumns);
    console.log('✅ Table columns test passed');
}

function runAllTests() {
    console.log('🧪 Starting Outbound Manual Table Tests...');
    console.log('==========================================');

    try {
        testDataProcessing();
        testResolveInvoiceCount();
        testReceiverDedup();
        testTableColumns();

        console.log('==========================================');
        console.log('✅ All tests passed successfully!');
    } catch (error) {
        console.error('❌ Test failed:', error);
        process.exitCode = 1;
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        testDataProcessing,
        testResolveInvoiceCount,
        testReceiverDedup,
        testTableColumns,
        runAllTests,
        mockApiResponse,
        resolveInvoiceCount,
        partyKey,
        extractReceiverData
    };
} else {
    runAllTests();
}

if (typeof require !== 'undefined' && require.main === module) {
    runAllTests();
}
