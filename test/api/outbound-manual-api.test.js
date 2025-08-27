const request = require('supertest');
const app = require('../../app');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

describe('Outbound Manual API Tests', () => {
    let authToken;
    let testUserId = 1; // Assuming user ID 1 exists

    beforeAll(async () => {
        // Setup test authentication
        // You may need to adjust this based on your auth system
        const loginResponse = await request(app)
            .post('/auth/login')
            .send({
                username: 'test@example.com',
                password: 'testpassword'
            });
        
        if (loginResponse.status === 200) {
            authToken = loginResponse.body.token;
        }
    });

    afterAll(async () => {
        await prisma.$disconnect();
    });

    describe('GET /api/outbound-files-manual/list-fixed-paths', () => {
        beforeEach(async () => {
            // Clean up test data
            await prisma.wP_UPLOADED_EXCEL_FILES.deleteMany({
                where: {
                    filename: {
                        startsWith: 'test_'
                    }
                }
            });

            // Create test data
            await prisma.wP_UPLOADED_EXCEL_FILES.create({
                data: {
                    filename: 'test_sample.xlsx',
                    original_filename: 'test_sample.xlsx',
                    file_path: '/test/path/test_sample.xlsx',
                    file_size: BigInt(1024),
                    invoice_count: 5,
                    processing_status: 'processed',
                    uploaded_by_user_id: testUserId,
                    uploaded_by_name: 'Test User',
                    upload_date: new Date(),
                    metadata: JSON.stringify({
                        totalAmount: 1500.50,
                        filenameValidation: {
                            parsedData: {
                                formattedDate: '2024-01-15'
                            }
                        }
                    })
                }
            });
        });

        afterEach(async () => {
            // Clean up test data
            await prisma.wP_UPLOADED_EXCEL_FILES.deleteMany({
                where: {
                    filename: {
                        startsWith: 'test_'
                    }
                }
            });
        });

        test('should return uploaded Excel files for authenticated user', async () => {
            const response = await request(app)
                .get('/api/outbound-files-manual/list-fixed-paths')
                .set('Authorization', `Bearer ${authToken}`)
                .expect(200);

            expect(response.body.success).toBe(true);
            expect(response.body.files).toBeDefined();
            expect(Array.isArray(response.body.files)).toBe(true);
            expect(response.body.total).toBeDefined();
        });

        test('should return correct data structure for table display', async () => {
            const response = await request(app)
                .get('/api/outbound-files-manual/list-fixed-paths')
                .set('Authorization', `Bearer ${authToken}`)
                .expect(200);

            if (response.body.files.length > 0) {
                const file = response.body.files[0];
                
                // Check required table columns
                expect(file.id).toBeDefined();
                expect(file.DT_RowId).toBeDefined();
                expect(file.fileName).toBeDefined();
                expect(file.invoiceNumber).toBeDefined();
                expect(file.supplier).toBeDefined();
                expect(file.receiver).toBeDefined();
                expect(file.date).toBeDefined();
                expect(file.invDateInfo).toBeDefined();
                expect(file.status).toBeDefined();
                expect(file.source).toBeDefined();
                expect(file.totalAmount).toBeDefined();
                
                // Check additional data
                expect(file.originalFilename).toBeDefined();
                expect(file.filePath).toBeDefined();
                expect(file.fileSize).toBeDefined();
                expect(file.uploadedBy).toBeDefined();
                expect(file.metadata).toBeDefined();
            }
        });

        test('should handle empty results gracefully', async () => {
            // Clean up all test data first
            await prisma.wP_UPLOADED_EXCEL_FILES.deleteMany({
                where: {
                    uploaded_by_user_id: testUserId
                }
            });

            const response = await request(app)
                .get('/api/outbound-files-manual/list-fixed-paths')
                .set('Authorization', `Bearer ${authToken}`)
                .expect(200);

            expect(response.body.success).toBe(true);
            expect(response.body.files).toEqual([]);
            expect(response.body.total).toBe(0);
        });

        test('should require authentication', async () => {
            await request(app)
                .get('/api/outbound-files-manual/list-fixed-paths')
                .expect(401);
        });

        test('should handle database errors gracefully', async () => {
            // Mock a database error by temporarily disconnecting
            await prisma.$disconnect();

            const response = await request(app)
                .get('/api/outbound-files-manual/list-fixed-paths')
                .set('Authorization', `Bearer ${authToken}`)
                .expect(500);

            expect(response.body.success).toBe(false);
            expect(response.body.error).toBeDefined();

            // Reconnect for cleanup
            await prisma.$connect();
        });
    });
});
