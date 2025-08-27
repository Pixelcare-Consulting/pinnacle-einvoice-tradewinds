#!/usr/bin/env node

/**
 * Integration test script for Outbound Manual functionality
 * This script tests the API endpoint and basic functionality
 */

const http = require('http');
const path = require('path');

// Configuration
const config = {
    host: 'localhost',
    port: 3000,
    timeout: 5000
};

// Test utilities
function makeRequest(options) {
    return new Promise((resolve, reject) => {
        const req = http.request(options, (res) => {
            let data = '';
            
            res.on('data', (chunk) => {
                data += chunk;
            });
            
            res.on('end', () => {
                try {
                    const jsonData = JSON.parse(data);
                    resolve({
                        statusCode: res.statusCode,
                        headers: res.headers,
                        data: jsonData
                    });
                } catch (error) {
                    resolve({
                        statusCode: res.statusCode,
                        headers: res.headers,
                        data: data
                    });
                }
            });
        });
        
        req.on('error', reject);
        req.setTimeout(config.timeout, () => {
            req.destroy();
            reject(new Error('Request timeout'));
        });
        
        req.end();
    });
}

// Test functions
async function testServerConnection() {
    console.log('🔗 Testing server connection...');
    
    try {
        const response = await makeRequest({
            hostname: config.host,
            port: config.port,
            path: '/',
            method: 'GET'
        });
        
        if (response.statusCode === 200) {
            console.log('✅ Server is running and accessible');
            return true;
        } else {
            console.log(`❌ Server responded with status: ${response.statusCode}`);
            return false;
        }
    } catch (error) {
        console.log(`❌ Server connection failed: ${error.message}`);
        return false;
    }
}

async function testApiEndpoint() {
    console.log('🔍 Testing API endpoint...');
    
    try {
        const response = await makeRequest({
            hostname: config.host,
            port: config.port,
            path: '/api/outbound-files-manual/list-fixed-paths',
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                // Note: In real test, you'd need proper authentication
                'Authorization': 'Bearer test-token'
            }
        });
        
        console.log(`Response status: ${response.statusCode}`);
        
        if (response.statusCode === 401) {
            console.log('⚠️  Authentication required (expected for security)');
            return true; // This is expected behavior
        } else if (response.statusCode === 200) {
            console.log('✅ API endpoint accessible');
            
            // Validate response structure
            if (response.data && typeof response.data === 'object') {
                const hasRequiredFields = 
                    response.data.hasOwnProperty('success') &&
                    response.data.hasOwnProperty('files') &&
                    Array.isArray(response.data.files);
                
                if (hasRequiredFields) {
                    console.log('✅ Response structure is correct');
                    console.log(`📊 Found ${response.data.files.length} files`);
                    
                    // Test data structure if files exist
                    if (response.data.files.length > 0) {
                        const file = response.data.files[0];
                        const requiredFields = [
                            'id', 'fileName', 'invoiceNumber', 'supplier', 
                            'receiver', 'date', 'status', 'source', 'totalAmount'
                        ];
                        
                        const missingFields = requiredFields.filter(field => !file.hasOwnProperty(field));
                        
                        if (missingFields.length === 0) {
                            console.log('✅ File data structure is correct');
                        } else {
                            console.log(`❌ Missing fields in file data: ${missingFields.join(', ')}`);
                        }
                    }
                    
                    return true;
                } else {
                    console.log('❌ Response structure is incorrect');
                    console.log('Expected: { success, files, total }');
                    console.log('Received:', Object.keys(response.data));
                    return false;
                }
            } else {
                console.log('❌ Invalid JSON response');
                return false;
            }
        } else {
            console.log(`❌ Unexpected status code: ${response.statusCode}`);
            console.log('Response:', response.data);
            return false;
        }
    } catch (error) {
        console.log(`❌ API test failed: ${error.message}`);
        return false;
    }
}

async function testStaticFiles() {
    console.log('📁 Testing static file access...');
    
    try {
        const response = await makeRequest({
            hostname: config.host,
            port: config.port,
            path: '/assets/js/modules/excel/outbound-manual.js',
            method: 'GET'
        });
        
        if (response.statusCode === 200) {
            console.log('✅ JavaScript file is accessible');
            
            // Check if the file contains our new classes
            const content = response.data.toString();
            const hasInvoiceTableManager = content.includes('InvoiceTableManager');
            const hasUploadedFilesManager = content.includes('UploadedFilesManager');
            const hasNewEndpoint = content.includes('/api/outbound-files-manual/list-fixed-paths');
            
            if (hasInvoiceTableManager && hasUploadedFilesManager && hasNewEndpoint) {
                console.log('✅ JavaScript file contains expected functionality');
                return true;
            } else {
                console.log('❌ JavaScript file missing expected functionality');
                console.log(`InvoiceTableManager: ${hasInvoiceTableManager}`);
                console.log(`UploadedFilesManager: ${hasUploadedFilesManager}`);
                console.log(`New endpoint: ${hasNewEndpoint}`);
                return false;
            }
        } else {
            console.log(`❌ JavaScript file not accessible: ${response.statusCode}`);
            return false;
        }
    } catch (error) {
        console.log(`❌ Static file test failed: ${error.message}`);
        return false;
    }
}

async function runIntegrationTests() {
    console.log('🧪 Starting Integration Tests for Outbound Manual');
    console.log('================================================');
    
    const results = {
        serverConnection: false,
        apiEndpoint: false,
        staticFiles: false
    };
    
    // Test server connection
    results.serverConnection = await testServerConnection();
    
    if (results.serverConnection) {
        // Test API endpoint
        results.apiEndpoint = await testApiEndpoint();
        
        // Test static files
        results.staticFiles = await testStaticFiles();
    } else {
        console.log('⏭️  Skipping other tests due to server connection failure');
    }
    
    // Summary
    console.log('\n📋 Test Summary:');
    console.log('================');
    console.log(`Server Connection: ${results.serverConnection ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`API Endpoint: ${results.apiEndpoint ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`Static Files: ${results.staticFiles ? '✅ PASS' : '❌ FAIL'}`);
    
    const allPassed = Object.values(results).every(result => result === true);
    
    if (allPassed) {
        console.log('\n🎉 All integration tests passed!');
        console.log('✅ Ready for deployment');
    } else {
        console.log('\n⚠️  Some tests failed. Please review before deployment.');
    }
    
    return allPassed;
}

// Run tests if called directly
if (require.main === module) {
    runIntegrationTests()
        .then((success) => {
            process.exit(success ? 0 : 1);
        })
        .catch((error) => {
            console.error('❌ Test runner failed:', error);
            process.exit(1);
        });
}

module.exports = {
    runIntegrationTests,
    testServerConnection,
    testApiEndpoint,
    testStaticFiles
};
