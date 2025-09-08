/**
 * Debug script to test Excel processing issue
 */

const { processManualUploadExcelData } = require('./services/lhdn/processManualUploadExcelData');

// Mock data based on the actual Excel structure from logs
const mockRawData = [
  // Header row 1 (descriptions)
  {
    "Invoice": "Internal Document Reference Number",
    "__EMPTY": "Original eInvoice Unique Identifier Number",
    "__EMPTY_1": "Original Internal Document Reference Number",
    "__EMPTY_31": "Full Legal Name",
    "__EMPTY_49": "Full Legal Name"
  },
  // Header row 2 (field mappings)
  {
    "Invoice": "Invoice",
    "__EMPTY": "UUID",
    "__EMPTY_1": "ID",
    "__EMPTY_31": "RegistrationName",
    "__EMPTY_49": "RegistrationName"
  },
  // Data row 1 (actual invoice data)
  {
    "Invoice": "PXCTIIB12341E1",
    "__EMPTY": "NA",
    "__EMPTY_1": "NA",
    "__EMPTY_2": 45891,
    "__EMPTY_3": "15:30:00Z",
    "__EMPTY_4": "01",
    "__EMPTY_5": "MYR",
    "__EMPTY_6": "MYR",
    "__EMPTY_7": 1,
    "__EMPTY_15": "C4890799050234",
    "__EMPTY_16": "213588D5454",
    "__EMPTY_31": "TRADEWINDS INTERNATIONAL INSURANCE BROKERS SDN BHD",
    "__EMPTY_49": "AIA BHD",
    "Buyer": "C20395547010",
    "__EMPTY_34": "200701032867"
  },
  // Data row 2
  {
    "Invoice": "PXCTIIB12341E2",
    "__EMPTY": "NA",
    "__EMPTY_1": "NA",
    "__EMPTY_31": "TRADEWINDS INTERNATIONAL INSURANCE BROKERS SDN BHD",
    "__EMPTY_49": "AIA BHD"
  },
  // Data row 3
  {
    "Invoice": "PXCTIIB12341E3",
    "__EMPTY": "NA",
    "__EMPTY_1": "NA",
    "__EMPTY_31": "TRADEWINDS INTERNATIONAL INSURANCE BROKERS SDN BHD",
    "__EMPTY_49": "AIA BHD"
  },
  // Data row 4
  {
    "Invoice": "PXCTIIB12341E4",
    "__EMPTY": "NA",
    "__EMPTY_1": "NA",
    "__EMPTY_31": "TRADEWINDS INTERNATIONAL INSURANCE BROKERS SDN BHD",
    "__EMPTY_49": "AIA BHD"
  }
];

async function testProcessing() {
  console.log('🧪 Testing Excel processing with mock data...');
  console.log('📊 Mock data structure:');
  console.log('- Total rows:', mockRawData.length);
  console.log('- Header rows: 2');
  console.log('- Data rows: 4');
  console.log('- Expected invoices: 4');
  
  console.log('\n📋 Sample data rows:');
  mockRawData.slice(2).forEach((row, index) => {
    console.log(`Row ${index + 3}:`, {
      Invoice: row.Invoice,
      SupplierName: row.__EMPTY_31,
      BuyerName: row.__EMPTY_49
    });
  });

  try {
    console.log('\n🔄 Processing...');
    const result = processManualUploadExcelData(mockRawData);
    
    console.log('\n📈 Results:');
    console.log('- Documents processed:', result.length);
    console.log('- Success:', result.length > 0);
    
    if (result.length > 0) {
      console.log('\n📄 First document sample:');
      const doc = result[0];
      console.log('- Invoice Number:', doc.header?.invoiceNo);
      console.log('- Supplier Name:', doc.supplier?.name);
      console.log('- Buyer Name:', doc.buyer?.name);
      console.log('- Has Items:', !!(doc.items && doc.items.length > 0));
      console.log('- Has Summary:', !!doc.summary);
    } else {
      console.log('\n❌ No documents were processed!');
    }
    
  } catch (error) {
    console.error('\n💥 Error during processing:', error);
  }
}

testProcessing();
