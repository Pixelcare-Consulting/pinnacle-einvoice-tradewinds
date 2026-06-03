/**
 * Real-Time Status Synchronization Test
 * 
 * This test verifies that the frontend receives accurate real-time updates
 * when backend validation fails during bulk submission processing.
 * 
 * Critical Issue: Backend logs show "Success: 0, Errors: 16" but frontend
 * displays success messages. This test ensures proper error propagation.
 */

const request = require('supertest');
const app = require('../app');
const { createPrismaClient } = require('../src/lib/prisma');

const prisma = createPrismaClient();

describe('Real-Time Status Synchronization', () => {
    let testUser;
    let testFiles;
    let sessionId;

    beforeAll(async () => {
        // Create test user
        testUser = await prisma.wP_USERS.create({
            data: {
                username: 'test_realtime_user',
                email: 'realtime@test.com',
                password: 'hashedpassword',
                role: 'user'
            }
        });

        // Create test files with validation issues
        testFiles = await Promise.all([
            prisma.wP_UPLOADED_EXCEL_FILES.create({
                data: {
                    filename: 'test_validation_fail_1.xlsx',
                    file_path: '/test/path/validation_fail_1.xlsx',
                    processing_status: 'processed',
                    invoice_count: 8,
                    user_id: testUser.id,
                    metadata: JSON.stringify({
                        invoiceNumbers: ['PXCTIIB12341E1', 'PXCTIIB12341E2', 'PXCTIIB12341E3', 'PXCTIIB12341E4', 'PXCTIIB12341E5', 'PXCTIIB12341E6', 'PXCTIIB12341E7', 'PXCTIIB12341E8']
                    })
                }
            }),
            prisma.wP_UPLOADED_EXCEL_FILES.create({
                data: {
                    filename: 'test_validation_fail_2.xlsx',
                    file_path: '/test/path/validation_fail_2.xlsx',
                    processing_status: 'processed',
                    invoice_count: 8,
                    user_id: testUser.id,
                    metadata: JSON.stringify({
                        invoiceNumbers: ['PXCTIIB12341E9', 'PXCTIIB12341E10', 'PXCTIIB12341E11', 'PXCTIIB12341E12', 'PXCTIIB12341E13', 'PXCTIIB12341E14', 'PXCTIIB12341E15', 'PXCTIIB12341E16']
                    })
                }
            })
        ]);

        sessionId = `test_session_${Date.now()}`;
    });

    afterAll(async () => {
        // Cleanup
        await prisma.wP_UPLOADED_EXCEL_FILES.deleteMany({
            where: { user_id: testUser.id }
        });
        await prisma.wP_USERS.delete({
            where: { id: testUser.id }
        });
        await prisma.$disconnect();
    });

    describe('Backend Status Tracking', () => {
        test('should initialize bulk submission status with correct structure', async () => {
            const response = await request(app)
                .post('/api/outbound-files-manual/bulk-submit-files')
                .set('X-Session-Id', sessionId)
                .set('Authorization', `Bearer ${testUser.token}`)
                .send({
                    fileIds: testFiles.map(f => f.id)
                });

            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);
            expect(response.body.message).toContain('Bulk submission initiated');
        });

        test('should track real-time status during processing', async () => {
            // Wait a moment for background processing to start
            await new Promise(resolve => setTimeout(resolve, 1000));

            const statusResponse = await request(app)
                .get(`/api/outbound-files-manual/bulk-submission-realtime-status/${sessionId}`)
                .set('Authorization', `Bearer ${testUser.token}`);

            expect(statusResponse.status).toBe(200);
            expect(statusResponse.body.success).toBe(true);
            
            const statusData = statusResponse.body.data;
            expect(statusData.hasActiveSubmission).toBe(true);
            expect(statusData.totalFiles).toBe(2);
            expect(statusData.files).toHaveLength(2);
            
            // Verify file tracking structure
            statusData.files.forEach(file => {
                expect(file).toHaveProperty('id');
                expect(file).toHaveProperty('filename');
                expect(file).toHaveProperty('status');
                expect(file).toHaveProperty('phase');
                expect(file).toHaveProperty('errors');
                expect(file).toHaveProperty('invoiceCount');
            });
        });
    });

    describe('Validation Failure Detection', () => {
        test('should detect and report validation failures in real-time', async () => {
            // Poll status until completion or validation failure
            let attempts = 0;
            let finalStatus = null;
            
            while (attempts < 30) { // Max 30 attempts (60 seconds)
                const statusResponse = await request(app)
                    .get(`/api/outbound-files-manual/bulk-submission-realtime-status/${sessionId}`)
                    .set('Authorization', `Bearer ${testUser.token}`);

                if (statusResponse.body.data?.hasActiveSubmission) {
                    const status = statusResponse.body.data;
                    
                    // Check if we've reached completion
                    if (status.currentPhase === 'completed' || status.overallStatus.includes('completed')) {
                        finalStatus = status;
                        break;
                    }
                    
                    // Check for validation failures
                    const validationFailures = status.files.filter(f => f.status === 'validation_failed');
                    if (validationFailures.length > 0) {
                        finalStatus = status;
                        break;
                    }
                }
                
                await new Promise(resolve => setTimeout(resolve, 2000));
                attempts++;
            }

            // Verify final status shows validation failures
            expect(finalStatus).not.toBeNull();
            expect(finalStatus.overallStatus).toBe('completed_with_errors');
            
            // Verify validation failure details
            const validationFailures = finalStatus.files.filter(f => f.status === 'validation_failed');
            expect(validationFailures.length).toBeGreaterThan(0);
            
            // Verify error details are captured
            validationFailures.forEach(file => {
                expect(file.errors).toBeDefined();
                expect(file.validationSummary).toBeDefined();
                expect(file.validationSummary.totalDocuments).toBeGreaterThan(0);
                expect(file.validationSummary.failedDocuments).toBeGreaterThan(0);
            });
        });

        test('should provide detailed validation error information', async () => {
            const statusResponse = await request(app)
                .get(`/api/outbound-files-manual/bulk-submission-realtime-status/${sessionId}`)
                .set('Authorization', `Bearer ${testUser.token}`);

            const status = statusResponse.body.data;
            const validationFailures = status.files.filter(f => f.status === 'validation_failed');
            
            if (validationFailures.length > 0) {
                const failedFile = validationFailures[0];
                
                // Verify error structure
                expect(failedFile.errors).toBeInstanceOf(Array);
                failedFile.errors.forEach(error => {
                    expect(error).toHaveProperty('invoiceNumber');
                    expect(error).toHaveProperty('index');
                    expect(error).toHaveProperty('errors');
                    expect(error.errors).toBeInstanceOf(Array);
                    
                    error.errors.forEach(err => {
                        expect(err).toHaveProperty('code');
                        expect(err).toHaveProperty('field');
                        expect(err).toHaveProperty('message');
                    });
                });
            }
        });
    });

    describe('Frontend Error Propagation', () => {
        test('should ensure frontend receives validation failure signals', async () => {
            // Simulate frontend polling behavior
            const statusResponse = await request(app)
                .get(`/api/outbound-files-manual/bulk-submission-realtime-status/${sessionId}`)
                .set('Authorization', `Bearer ${testUser.token}`);

            const status = statusResponse.body.data;
            
            // Verify the status structure matches what frontend expects
            expect(status).toHaveProperty('hasActiveSubmission');
            expect(status).toHaveProperty('currentPhase');
            expect(status).toHaveProperty('overallStatus');
            expect(status).toHaveProperty('files');
            
            // Verify validation failure detection
            if (status.overallStatus === 'completed_with_errors') {
                const validationFailures = status.files.filter(f => f.status === 'validation_failed');
                expect(validationFailures.length).toBeGreaterThan(0);
                
                // This is the critical test: ensure frontend can detect validation failures
                const shouldShowValidationError = validationFailures.length > 0;
                expect(shouldShowValidationError).toBe(true);
                
                // Verify error aggregation for frontend display
                const allErrors = [];
                validationFailures.forEach(file => {
                    if (file.errors && Array.isArray(file.errors)) {
                        allErrors.push(...file.errors.map(err => ({
                            ...err,
                            filename: file.filename
                        })));
                    }
                });
                
                expect(allErrors.length).toBeGreaterThan(0);
                console.log(`✅ Validation errors properly detected: ${allErrors.length} errors across ${validationFailures.length} files`);
            }
        });
    });

    describe('Status Consistency Verification', () => {
        test('should ensure backend logs match frontend display', async () => {
            const statusResponse = await request(app)
                .get(`/api/outbound-files-manual/bulk-submission-realtime-status/${sessionId}`)
                .set('Authorization', `Bearer ${testUser.token}`);

            const status = statusResponse.body.data;
            
            if (status.summary) {
                const { totalFiles, successfulFiles, errorFiles, validationFailedFiles } = status.summary;
                
                // Verify the math adds up
                expect(successfulFiles + errorFiles + validationFailedFiles).toBeLessThanOrEqual(totalFiles);
                
                // Critical verification: if backend shows 0 success, frontend should not show success
                if (successfulFiles === 0 && (errorFiles > 0 || validationFailedFiles > 0)) {
                    expect(status.overallStatus).not.toBe('completed_successfully');
                    expect(status.overallStatus).toBe('completed_with_errors');
                    
                    console.log(`✅ Status consistency verified: Success: ${successfulFiles}, Errors: ${errorFiles}, Validation Failed: ${validationFailedFiles}`);
                }
            }
        });
    });
});
