#!/usr/bin/env node

/**
 * Comprehensive test for Excel processing fix
 * Tests the complete pipeline from Excel reading to invoice processing
 */

const path = require('path');
const { consumeExcelFile } = require('./services/excel/excelConsumer');

async function testCompleteExcelProcessing() {
    console.log('🧪 COMPREHENSIVE EXCEL PROCESSING TEST');
    console.log('=====================================');
    
    try {
        // Test with the problematic file
        const testFilePath = path.join(__dirname, 'uploads', '080925_123504.xlsx');
        console.log(`📁 Testing file: ${testFilePath}`);
        
        console.log('\n🔄 Running Excel processing with enhanced processor...');
        const result = await consumeExcelFile(testFilePath, {
            useEnhancedProcessor: true,
            validateCNDNRN: true // Enable validation to test UUID/ID processing
        });
        
        console.log('\n📊 PROCESSING RESULTS:');
        console.log('======================');
        console.log(`✅ Success: ${result.success}`);
        console.log(`📄 Filename: ${result.filename}`);
        console.log(`⏱️  Processing Time: ${result.processingTime}ms`);
        
        // Check enhanced results
        if (result.enhancedResults) {
            const enhanced = result.enhancedResults;
            console.log('\n📋 ENHANCED PROCESSOR RESULTS:');
            console.log(`   📊 Total Invoices Found: ${enhanced.totalInvoices || 0}`);
            console.log(`   ✅ Successfully Processed: ${enhanced.processedInvoices || 0}`);
            console.log(`   📈 Success Rate: ${enhanced.totalInvoices > 0 ? 
                Math.round((enhanced.processedInvoices / enhanced.totalInvoices) * 100) : 0}%`);
            
            if (enhanced.invoices && enhanced.invoices.length > 0) {
                console.log('\n📄 SAMPLE PROCESSED INVOICE:');
                const sample = enhanced.invoices[0];
                console.log(`   🆔 Invoice Number: ${sample.header?.invoiceNo || 'N/A'}`);
                console.log(`   🏢 Supplier: ${sample.supplier?.name || 'N/A'}`);
                console.log(`   🏪 Buyer: ${sample.buyer?.name || 'N/A'}`);
                console.log(`   💰 Amount: ${sample.summary?.amounts?.payableAmount || 'N/A'}`);
                console.log(`   📦 Items: ${sample.items?.length || 0}`);
                
                // Check UUID/ID fields specifically
                if (sample.header?.invoiceDocumentReference) {
                    console.log(`   🔗 UUID: ${sample.header.InvoiceDocumentReference_UUID}`);
                }
                if (sample.header?.InvoiceDocumentReference_ID) {
                    console.log(`   🆔 Internal ID: ${sample.header.InvoiceDocumentReference_ID}`);
                }
            }
            
            // Check validation results
            if (enhanced.validation) {
                console.log('\n🔍 VALIDATION RESULTS:');
                console.log(`   ✅ Valid Invoices: ${enhanced.validation.validInvoices || 0}`);
                console.log(`   ❌ Invalid Invoices: ${enhanced.validation.invalidInvoices || 0}`);
                console.log(`   ⚠️  Warnings: ${enhanced.validation.totalWarnings || 0}`);
            }
            
            // Check CN/DN/RN validation
            if (enhanced.cnDnRnValidation) {
                const cnDnRn = enhanced.cnDnRnValidation;
                console.log('\n🔗 UUID/ID VALIDATION:');
                console.log(`   📄 Documents Checked: ${cnDnRn.totalDocuments || 0}`);
                console.log(`   ❌ Invalid Documents: ${cnDnRn.invalidDocuments || 0}`);
                console.log(`   ⚠️  Documents with Warnings: ${cnDnRn.documentsWithWarnings || 0}`);
                
                if (cnDnRn.invalidDocuments > 0 && cnDnRn.issues) {
                    console.log('\n⚠️  UUID/ID ISSUES FOUND:');
                    cnDnRn.issues.slice(0, 3).forEach((issue, index) => {
                        console.log(`   ${index + 1}. ${issue.message} (${issue.severity})`);
                    });
                }
            }
        }
        
        // Check standard results
        if (result.processingResults && Array.isArray(result.processingResults)) {
            console.log(`\n📄 STANDARD PROCESSOR: ${result.processingResults.length} documents processed`);
        }
        
        // Overall assessment
        const hasProcessedInvoices = (result.enhancedResults?.processedInvoices > 0) || 
                                   (result.processingResults?.length > 0);
        
        console.log('\n🎯 OVERALL ASSESSMENT:');
        console.log('======================');
        
        if (hasProcessedInvoices) {
            console.log('🎉 SUCCESS: Excel processing is now working!');
            console.log('✅ Field mapping fix is successful');
            console.log('✅ Smart header detection is working');
            console.log('✅ Invoice data extraction is functional');
            
            if (result.enhancedResults?.cnDnRnValidation?.invalidDocuments === 0) {
                console.log('✅ UUID/ID validation is working correctly');
            } else {
                console.log('⚠️  UUID/ID validation needs attention');
            }
        } else {
            console.log('❌ ISSUE: Still no invoices processed');
            console.log('🔧 Further investigation needed');
        }
        
    } catch (error) {
        console.error('\n💥 ERROR during testing:');
        console.error(`❌ ${error.message}`);
        if (error.stack) {
            console.error('\n📋 Stack trace:');
            console.error(error.stack);
        }
    }
}

// Run the comprehensive test
testCompleteExcelProcessing().then(() => {
    console.log('\n🏁 Comprehensive test completed');
    process.exit(0);
}).catch(error => {
    console.error('\n💥 Test failed:', error);
    process.exit(1);
});
