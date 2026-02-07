import { INestApplication } from '@nestjs/common';
import {
  setupTestApp,
  teardownTestApp,
  resetDatabase,
  createTenantWithUser,
} from '../../../setup/test-app.bootstrap';
import { authenticatedRequest, pollUntil } from '../../../setup/test-helpers';
import { financialRecordFactory } from '../../../setup/test-data-factories';

describe('ETL Validation (Tenant Context)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await setupTestApp();
  });

  afterAll(async () => {
    await teardownTestApp();
  });

  beforeEach(async () => {
    await resetDatabase();
  });

  describe('Data validation', () => {
    it('should validate and load correct records', async () => {
      const tenant = await createTenantWithUser('admin@test.com', 'ADMIN');

      const validRecords = [
        financialRecordFactory.invoice(),
        financialRecordFactory.invoice(),
        financialRecordFactory.invoice(),
      ];

      const response = await authenticatedRequest(app, tenant.token)
        .post('/etl/ingest')
        .send({
          source: 'csv_upload',
          entityType: 'invoice',
          records: validRecords,
        })
        .expect(202);

      expect(response.body).toMatchObject({
        jobId: expect.any(String),
        status: 'processing',
        totalRecords: 3,
      });

      // Poll until ETL completes
      await pollUntil(async () => {
        const statusResponse = await authenticatedRequest(app, tenant.token)
          .get(`/etl/jobs/${response.body.jobId}`)
          .expect(200);

        return statusResponse.body.status === 'completed';
      });

      // Verify records were loaded
      const invoicesResponse = await authenticatedRequest(app, tenant.token)
        .get('/invoices')
        .expect(200);

      expect(invoicesResponse.body.data).toHaveLength(3);
    });

    it('should quarantine invalid records', async () => {
      const tenant = await createTenantWithUser('admin@test.com', 'ADMIN');

      const mixedRecords = [
        financialRecordFactory.invoice(), // Valid
        { ...financialRecordFactory.invoice(), invoice_date: 'invalid-date' }, // Invalid date
        { ...financialRecordFactory.invoice(), total_amount: 'not-a-number' }, // Invalid amount
        financialRecordFactory.invoice(), // Valid
      ];

      const response = await authenticatedRequest(app, tenant.token)
        .post('/etl/ingest')
        .send({
          source: 'csv_upload',
          entityType: 'invoice',
          records: mixedRecords,
        })
        .expect(202);

      await pollUntil(async () => {
        const statusResponse = await authenticatedRequest(app, tenant.token)
          .get(`/etl/jobs/${response.body.jobId}`)
          .expect(200);

        return statusResponse.body.status === 'completed';
      });

      // Check quarantine
      const quarantineResponse = await authenticatedRequest(app, tenant.token)
        .get('/etl/quarantine')
        .expect(200);

      expect(quarantineResponse.body.data).toHaveLength(2);
      expect(quarantineResponse.body.data[0]).toMatchObject({
        errorType: expect.any(String),
        errorMessage: expect.any(String),
        record: expect.any(Object),
        suggestions: expect.any(Array),
      });

      // Verify only valid records were loaded
      const invoicesResponse = await authenticatedRequest(app, tenant.token)
        .get('/invoices')
        .expect(200);

      expect(invoicesResponse.body.data).toHaveLength(2);
    });

    it('should provide fix suggestions for quarantined records', async () => {
      const tenant = await createTenantWithUser('admin@test.com', 'ADMIN');

      const invalidRecord = {
        ...financialRecordFactory.invoice(),
        invoice_date: '2024-13-45', // Invalid date
      };

      await authenticatedRequest(app, tenant.token)
        .post('/etl/ingest')
        .send({
          source: 'csv_upload',
          entityType: 'invoice',
          records: [invalidRecord],
        });

      await pollUntil(async () => {
        const quarantineResponse = await authenticatedRequest(app, tenant.token)
          .get('/etl/quarantine')
          .expect(200);

        return quarantineResponse.body.data.length > 0;
      });

      const quarantineResponse = await authenticatedRequest(app, tenant.token)
        .get('/etl/quarantine')
        .expect(200);

      expect(quarantineResponse.body.data[0].suggestions).toContainEqual(
        expect.objectContaining({
          field: 'invoice_date',
          message: expect.stringContaining('date format'),
          suggestedValue: expect.any(String),
        }),
      );
    });

    it('should deduplicate records by business key', async () => {
      const tenant = await createTenantWithUser('admin@test.com', 'ADMIN');

      const duplicateRecords = [
        financialRecordFactory.invoice({ invoice_id: 'INV-001' }),
        financialRecordFactory.invoice({ invoice_id: 'INV-001' }), // Duplicate
        financialRecordFactory.invoice({ invoice_id: 'INV-002' }),
      ];

      await authenticatedRequest(app, tenant.token).post('/etl/ingest').send({
        source: 'csv_upload',
        entityType: 'invoice',
        records: duplicateRecords,
      });

      await pollUntil(async () => {
        const invoicesResponse = await authenticatedRequest(app, tenant.token)
          .get('/invoices')
          .expect(200);

        return invoicesResponse.body.data.length > 0;
      });

      const invoicesResponse = await authenticatedRequest(app, tenant.token)
        .get('/invoices')
        .expect(200);

      expect(invoicesResponse.body.data).toHaveLength(2); // Only unique records
    });
  });
});
