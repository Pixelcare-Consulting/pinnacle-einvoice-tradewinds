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

describe('Outbound manual invoice date formatting', () => {
    const context = loadOutboundManualContext();

    test('DD/MM/YYYY is not reinterpreted as MM/DD/YYYY', () => {
        expect(context.formatManualInvoiceDateForDisplay('11/05/2026')).toBe('11/05/2026');
    });

    test('ISO datetime renders in Malaysian format', () => {
        expect(context.formatManualInvoiceDateForDisplay('2026-05-11T00:00:00.000Z')).toBe('11/05/2026');
    });

    test('ISO date-only metadata renders as DD/MM/YYYY', () => {
        expect(context.formatManualInvoiceDateForDisplay('2026-05-11')).toBe('11/05/2026');
    });

    test('filename-derived date stays DD/MM/YYYY', () => {
        expect(context.formatManualInvoiceDateForDisplay('05/11/2026')).toBe('05/11/2026');
    });
});
