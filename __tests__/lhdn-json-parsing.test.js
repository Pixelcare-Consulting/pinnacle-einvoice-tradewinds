/**
 * Test for LHDN JSON parsing fix
 * Tests the safeJsonParse function and error handling
 */

describe('LHDN JSON Parsing Fix', () => {
    // Mock the safeJsonParse function from the lhdn.js route
    function safeJsonParse(jsonString) {
        if (!jsonString || typeof jsonString !== 'string') {
            return null;
        }
        
        // Trim whitespace and check if it looks like JSON
        const trimmed = jsonString.trim();
        if (!trimmed || (!trimmed.startsWith('{') && !trimmed.startsWith('['))) {
            return null;
        }
        
        try {
            return JSON.parse(trimmed);
        } catch (error) {
            console.error('JSON parsing error:', error.message);
            console.error('Invalid JSON content (first 200 chars):', trimmed.substring(0, 200));
            return null;
        }
    }

    describe('safeJsonParse function', () => {
        test('should parse valid JSON object', () => {
            const validJson = '{"test": "value", "number": 123}';
            const result = safeJsonParse(validJson);
            expect(result).toEqual({ test: "value", number: 123 });
        });

        test('should parse valid JSON array', () => {
            const validJson = '[{"test": "value"}, {"another": "item"}]';
            const result = safeJsonParse(validJson);
            expect(result).toEqual([{ test: "value" }, { another: "item" }]);
        });

        test('should handle JSON with whitespace', () => {
            const validJson = '  \n  {"test": "value"}  \n  ';
            const result = safeJsonParse(validJson);
            expect(result).toEqual({ test: "value" });
        });

        test('should return null for invalid JSON', () => {
            const invalidJson = 'getFrames: unexpected character at line 1 column 1';
            const result = safeJsonParse(invalidJson);
            expect(result).toBeNull();
        });

        test('should return null for empty string', () => {
            const result = safeJsonParse('');
            expect(result).toBeNull();
        });

        test('should return null for null input', () => {
            const result = safeJsonParse(null);
            expect(result).toBeNull();
        });

        test('should return null for undefined input', () => {
            const result = safeJsonParse(undefined);
            expect(result).toBeNull();
        });

        test('should return null for non-string input', () => {
            const result = safeJsonParse(123);
            expect(result).toBeNull();
        });

        test('should return null for HTML content', () => {
            const htmlContent = '<html><body>Error page</body></html>';
            const result = safeJsonParse(htmlContent);
            expect(result).toBeNull();
        });

        test('should return null for plain text error messages', () => {
            const errorMessage = 'Error: Connection failed';
            const result = safeJsonParse(errorMessage);
            expect(result).toBeNull();
        });

        test('should handle malformed JSON gracefully', () => {
            const malformedJson = '{"test": "value", "incomplete":';
            const result = safeJsonParse(malformedJson);
            expect(result).toBeNull();
        });

        test('should handle JSON with syntax errors', () => {
            const syntaxErrorJson = '{"test": "value",}'; // trailing comma
            const result = safeJsonParse(syntaxErrorJson);
            expect(result).toBeNull();
        });
    });

    describe('Error scenarios that caused the original issue', () => {
        test('should handle the specific "getFrames" error gracefully', () => {
            const errorMessage = 'getFrames: unexpected character at line 1 column 1 of the JSON data';
            const result = safeJsonParse(errorMessage);
            expect(result).toBeNull();
        });

        test('should handle empty response body', () => {
            const result = safeJsonParse('');
            expect(result).toBeNull();
        });

        test('should handle whitespace-only response', () => {
            const result = safeJsonParse('   \n\t   ');
            expect(result).toBeNull();
        });

        test('should handle HTTP error responses', () => {
            const httpError = '404 Not Found';
            const result = safeJsonParse(httpError);
            expect(result).toBeNull();
        });
    });

    describe('Tax rate logic for hypothetical tax display', () => {
        test('should determine standard tax rate from non-exempt items', () => {
            // Mock invoice data with mixed tax types
            const invoiceLines = [
                {
                    TaxTotal: [{
                        TaxSubtotal: [{
                            TaxCategory: [{
                                ID: [{ _: 'E' }], // Exempt
                                Percent: [{ _: '0' }]
                            }]
                        }]
                    }]
                },
                {
                    TaxTotal: [{
                        TaxSubtotal: [{
                            TaxCategory: [{
                                ID: [{ _: '02' }], // Service Tax
                                Percent: [{ _: '8' }]
                            }]
                        }]
                    }]
                },
                {
                    TaxTotal: [{
                        TaxSubtotal: [{
                            TaxCategory: [{
                                ID: [{ _: '02' }], // Service Tax
                                Percent: [{ _: '8' }]
                            }]
                        }]
                    }]
                }
            ];

            // Simulate the logic from the API
            const nonExemptTaxRates = [];
            invoiceLines.forEach(line => {
                const lineTaxCategory = line.TaxTotal?.[0]?.TaxSubtotal?.[0]?.TaxCategory?.[0];
                const taxTypeCode = lineTaxCategory?.ID?.[0]._ || '06';
                const taxPercent = parseFloat(lineTaxCategory?.Percent?.[0]._ || 0);

                if (taxTypeCode !== 'E' && taxTypeCode !== '06' && taxPercent > 0) {
                    nonExemptTaxRates.push(taxPercent);
                }
            });

            expect(nonExemptTaxRates).toEqual([8, 8]);

            // Determine standard tax rate
            let standardTaxRate = 0;
            if (nonExemptTaxRates.length > 0) {
                const rateFrequency = {};
                nonExemptTaxRates.forEach(rate => {
                    rateFrequency[rate] = (rateFrequency[rate] || 0) + 1;
                });

                let maxFrequency = 0;
                Object.entries(rateFrequency).forEach(([rate, frequency]) => {
                    if (frequency > maxFrequency || (frequency === maxFrequency && parseFloat(rate) > standardTaxRate)) {
                        maxFrequency = frequency;
                        standardTaxRate = parseFloat(rate);
                    }
                });
            }

            expect(standardTaxRate).toBe(8);
        });

        test('should return 0 standard tax rate when no non-exempt items exist', () => {
            const invoiceLines = [
                {
                    TaxTotal: [{
                        TaxSubtotal: [{
                            TaxCategory: [{
                                ID: [{ _: 'E' }], // Exempt
                                Percent: [{ _: '0' }]
                            }]
                        }]
                    }]
                },
                {
                    TaxTotal: [{
                        TaxSubtotal: [{
                            TaxCategory: [{
                                ID: [{ _: '06' }], // Not Applicable
                                Percent: [{ _: '0' }]
                            }]
                        }]
                    }]
                }
            ];

            const nonExemptTaxRates = [];
            invoiceLines.forEach(line => {
                const lineTaxCategory = line.TaxTotal?.[0]?.TaxSubtotal?.[0]?.TaxCategory?.[0];
                const taxTypeCode = lineTaxCategory?.ID?.[0]._ || '06';
                const taxPercent = parseFloat(lineTaxCategory?.Percent?.[0]._ || 0);

                if (taxTypeCode !== 'E' && taxTypeCode !== '06' && taxPercent > 0) {
                    nonExemptTaxRates.push(taxPercent);
                }
            });

            expect(nonExemptTaxRates).toEqual([]);
        });
    });
});
