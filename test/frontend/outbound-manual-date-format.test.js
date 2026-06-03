const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadOutboundManualContext() {
    const sourcePath = path.join(__dirname, '..', '..', 'public', 'assets', 'js', 'modules', 'excel', 'outbound-manual.js');
    const source = fs.readFileSync(sourcePath, 'utf8');

    const documentStub = {
        addEventListener() {},
        getElementById() { return null; },
        querySelector() { return null; },
        querySelectorAll() { return []; },
        createElement() {
            return {
                style: {},
                setAttribute() {},
                addEventListener() {},
                appendChild() {},
                remove() {}
            };
        },
        head: { appendChild() {} },
        body: { appendChild() {} }
    };

    const context = {
        console,
        setTimeout,
        clearTimeout,
        document: documentStub,
        window: {},
        navigator: { clipboard: { writeText: async () => {} } },
        bootstrap: undefined,
        Swal: { fire: async () => ({ isConfirmed: false }) },
        FormData: function FormData() {},
        Blob: function Blob() {},
        URL: {
            createObjectURL() { return 'blob:test'; },
            revokeObjectURL() {}
        }
    };

    context.global = context;
    vm.runInNewContext(source, context, { filename: sourcePath });
    return context;
}

const context = loadOutboundManualContext();

assert.strictEqual(
    context.formatManualInvoiceDateForDisplay('11/05/2026'),
    '11/05/2026',
    'DD/MM/YYYY invoice dates should not be reinterpreted as MM/DD/YYYY'
);

assert.strictEqual(
    context.formatManualInvoiceDateForDisplay('2026-05-11T00:00:00.000Z'),
    '11/05/2026',
    'ISO invoice dates should still render in Malaysian date format'
);

console.log('Outbound manual invoice date formatting test passed');
