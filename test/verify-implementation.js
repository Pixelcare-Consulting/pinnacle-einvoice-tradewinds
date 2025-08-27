#!/usr/bin/env node

/**
 * Verification script for Outbound Manual implementation
 * This script verifies the code structure without needing a running server
 */

const fs = require('fs');
const path = require('path');

// File paths to check
const files = {
    apiRoute: 'routes/api/outbound-manual.routes.js',
    frontendJs: 'public/assets/js/modules/excel/outbound-manual.js',
    htmlTemplate: 'views/dashboard/outbound-manual.html'
};

// Verification functions
function checkFileExists(filePath) {
    const fullPath = path.join(process.cwd(), filePath);
    return fs.existsSync(fullPath);
}

function readFileContent(filePath) {
    const fullPath = path.join(process.cwd(), filePath);
    try {
        return fs.readFileSync(fullPath, 'utf8');
    } catch (error) {
        return null;
    }
}

function verifyApiRoute() {
    console.log('🔍 Verifying API route...');
    
    const content = readFileContent(files.apiRoute);
    if (!content) {
        console.log('❌ API route file not found');
        return false;
    }
    
    const checks = [
        {
            name: 'list-fixed-paths endpoint',
            pattern: /router\.get\(['"`]\/list-fixed-paths['"`]/,
            required: true
        },
        {
            name: 'WP_UPLOADED_EXCEL_FILES query',
            pattern: /prisma\.wP_UPLOADED_EXCEL_FILES\.findMany/,
            required: true
        },
        {
            name: 'Response structure with files array',
            pattern: /files:\s*transformedFiles/,
            required: true
        },
        {
            name: 'Table column mapping',
            pattern: /fileName.*invoiceNumber.*supplier.*receiver/s,
            required: true
        },
        {
            name: 'Authentication middleware',
            pattern: /auth\.isApiAuthenticated/,
            required: true
        }
    ];
    
    let passed = 0;
    checks.forEach(check => {
        const found = check.pattern.test(content);
        if (found) {
            console.log(`  ✅ ${check.name}`);
            passed++;
        } else {
            console.log(`  ${check.required ? '❌' : '⚠️'} ${check.name}`);
        }
    });
    
    const success = passed >= checks.filter(c => c.required).length;
    console.log(`  📊 API Route: ${passed}/${checks.length} checks passed`);
    return success;
}

function verifyFrontendJs() {
    console.log('🔍 Verifying frontend JavaScript...');
    
    const content = readFileContent(files.frontendJs);
    if (!content) {
        console.log('❌ Frontend JS file not found');
        return false;
    }
    
    const checks = [
        {
            name: 'InvoiceTableManager class',
            pattern: /class\s+InvoiceTableManager/,
            required: true
        },
        {
            name: 'UploadedFilesManager class',
            pattern: /class\s+UploadedFilesManager/,
            required: true
        },
        {
            name: 'API endpoint URL',
            pattern: /\/api\/outbound-files-manual\/list-fixed-paths/,
            required: true
        },
        {
            name: 'Table column configuration',
            pattern: /fileName.*invoiceNumber.*supplier.*receiver/s,
            required: true
        },
        {
            name: 'Render methods',
            pattern: /renderFileName.*renderSupplier.*renderReceiver/s,
            required: true
        },
        {
            name: 'Data processing in dataSrc',
            pattern: /dataSrc:\s*\(json\)\s*=>/,
            required: true
        },
        {
            name: 'File size formatting',
            pattern: /formatFileSize/,
            required: true
        },
        {
            name: 'Currency formatting',
            pattern: /toLocaleString.*minimumFractionDigits/,
            required: true
        }
    ];
    
    let passed = 0;
    checks.forEach(check => {
        const found = check.pattern.test(content);
        if (found) {
            console.log(`  ✅ ${check.name}`);
            passed++;
        } else {
            console.log(`  ${check.required ? '❌' : '⚠️'} ${check.name}`);
        }
    });
    
    const success = passed >= checks.filter(c => c.required).length;
    console.log(`  📊 Frontend JS: ${passed}/${checks.length} checks passed`);
    return success;
}

function verifyHtmlTemplate() {
    console.log('🔍 Verifying HTML template...');
    
    const content = readFileContent(files.htmlTemplate);
    if (!content) {
        console.log('❌ HTML template file not found');
        return false;
    }
    
    const checks = [
        {
            name: 'Table with correct ID',
            pattern: /<table[^>]*id=['"]invoiceTable['"][^>]*>/,
            required: true
        },
        {
            name: 'Table headers match specification',
            pattern: /FILE NAME.*INVOICE NO.*SUPPLIER.*RECEIVER.*DATE.*STATUS.*SOURCE.*TOTAL AMOUNT.*ACTION/s,
            required: true
        },
        {
            name: 'Checkbox column',
            pattern: /outbound-checkbox-column/,
            required: true
        },
        {
            name: 'JavaScript file inclusion',
            pattern: /outbound-manual\.js/,
            required: true
        }
    ];
    
    let passed = 0;
    checks.forEach(check => {
        const found = check.pattern.test(content);
        if (found) {
            console.log(`  ✅ ${check.name}`);
            passed++;
        } else {
            console.log(`  ${check.required ? '❌' : '⚠️'} ${check.name}`);
        }
    });
    
    const success = passed >= checks.filter(c => c.required).length;
    console.log(`  📊 HTML Template: ${passed}/${checks.length} checks passed`);
    return success;
}

function verifySyntax() {
    console.log('🔍 Verifying syntax...');
    
    const { execSync } = require('child_process');
    
    try {
        // Check API route syntax
        execSync(`node -c "${files.apiRoute}"`, { stdio: 'pipe' });
        console.log('  ✅ API route syntax');
        
        // Check frontend JS syntax
        execSync(`node -c "${files.frontendJs}"`, { stdio: 'pipe' });
        console.log('  ✅ Frontend JS syntax');
        
        return true;
    } catch (error) {
        console.log('  ❌ Syntax error detected');
        console.log(`  Error: ${error.message}`);
        return false;
    }
}

function runVerification() {
    console.log('🧪 Verifying Outbound Manual Implementation');
    console.log('==========================================');
    
    // Check if all files exist
    console.log('📁 Checking file existence...');
    const fileChecks = Object.entries(files).map(([name, path]) => {
        const exists = checkFileExists(path);
        console.log(`  ${exists ? '✅' : '❌'} ${name}: ${path}`);
        return exists;
    });
    
    if (!fileChecks.every(check => check)) {
        console.log('\n❌ Some required files are missing. Cannot proceed with verification.');
        return false;
    }
    
    console.log('\n🔧 Running verification checks...');
    
    const results = {
        syntax: verifySyntax(),
        apiRoute: verifyApiRoute(),
        frontendJs: verifyFrontendJs(),
        htmlTemplate: verifyHtmlTemplate()
    };
    
    // Summary
    console.log('\n📋 Verification Summary:');
    console.log('========================');
    Object.entries(results).forEach(([test, passed]) => {
        console.log(`${test.padEnd(15)}: ${passed ? '✅ PASS' : '❌ FAIL'}`);
    });
    
    const allPassed = Object.values(results).every(result => result === true);
    
    if (allPassed) {
        console.log('\n🎉 All verification checks passed!');
        console.log('✅ Implementation is ready for testing');
        console.log('\n📝 Next steps:');
        console.log('1. Start the server: pnpm start');
        console.log('2. Navigate to the outbound manual page');
        console.log('3. Verify the table displays uploaded Excel files');
        console.log('4. Test file upload and table refresh functionality');
    } else {
        console.log('\n⚠️  Some verification checks failed.');
        console.log('Please review the implementation before proceeding.');
    }
    
    return allPassed;
}

// Run verification if called directly
if (require.main === module) {
    const success = runVerification();
    process.exit(success ? 0 : 1);
}

module.exports = {
    runVerification,
    verifyApiRoute,
    verifyFrontendJs,
    verifyHtmlTemplate,
    verifySyntax
};
