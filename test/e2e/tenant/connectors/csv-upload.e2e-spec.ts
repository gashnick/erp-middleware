import { INestApplication } from '@nestjs/common';
import {
  setupTestApp,
  teardownTestApp,
  resetDatabase,
  createTenantWithUser,
} from '../../../setup/test-app.bootstrap';
import { authenticatedRequest, pollUntil } from '../../../setup/test-helpers';
import { financialRecordFactory } from '../../../setup/test-data-factories';

describe('CSV Upload Connector (e2e)', () => {
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

  describe('POST /etl/ingest', () => {
    it('should upload a CSV and process invoices via ETL', async () => {
      // Create tenant with admin user
      const tenant = await createTenantWithUser('admin@test.com', 'ADMIN');

      // Prepare CSV records
      const records = [
        financialRecordFactory.invoice({
          invoice_id: 'INV-1',
          invoice_date: '2023-01-01',
          customer_name: 'Customer A',
          total_amount: 100.0,
        }),
      ];

      // Upload via ETL endpoint
      const response = await authenticatedRequest(app, tenant.token)
        .post('/etl/ingest')
        .send({
          source: 'csv_upload',
          entityType: 'invoice',
          records,
        })
        .expect(202);

      expect(response.body).toHaveProperty('jobId');

      const jobId = response.body.jobId || response.body.id;

      // Poll for job completion
      await pollUntil(
        async () => {
          const status = await authenticatedRequest(app, tenant.token).get(`/etl/jobs/${jobId}`);
          return status.body.status === 'completed';
        },
        30,
        500,
      );

      // Verify the job completed successfully
      const jobStatus = await authenticatedRequest(app, tenant.token)
        .get(`/etl/jobs/${jobId}`)
        .expect(200);

      expect(jobStatus.body.status).toBe('completed');

      // Verify dashboard data reflects the uploaded invoice
      const dashboard = await authenticatedRequest(app, tenant.token)
        .get('/dashboard/finance')
        .expect(200);

      expect(dashboard.body).toHaveProperty('cashFlow');
      expect(dashboard.body).toHaveProperty('arAging');
    });

    it('should handle malformed CSV records gracefully', async () => {
      const tenant = await createTenantWithUser('staff@test.com', 'ADMIN');

      // Invalid record - missing required fields
      const invalidRecords = [{ invoice_id: 'INV-BAD' }];

      const response = await authenticatedRequest(app, tenant.token)
        .post('/etl/ingest')
        .send({
          source: 'csv_upload',
          entityType: 'invoice',
          records: invalidRecords,
        })
        .expect(202);

      const jobId = response.body.jobId || response.body.id;

      // Job should complete (even with invalid records)
      await pollUntil(
        async () => {
          const status = await authenticatedRequest(app, tenant.token).get(`/etl/jobs/${jobId}`);
          return ['completed', 'failed'].includes(status.body.status);
        },
        30,
        500,
      );

      // Check quarantine for invalid records
      const quarantine = await authenticatedRequest(app, tenant.token)
        .get('/etl/quarantine')
        .expect(200);

      expect(quarantine.body).toHaveProperty('data');
      expect(Array.isArray(quarantine.body.data)).toBe(true);
    });

    it('should process multiple CSV records in a batch', async () => {
      const tenant = await createTenantWithUser('batch@test.com', 'ADMIN');

      // Multiple valid records
      const records = [
        financialRecordFactory.invoice({
          invoice_id: 'INV-001',
          invoice_date: '2023-01-01',
          customer_name: 'Customer A',
          total_amount: 100.0,
        }),
        financialRecordFactory.invoice({
          invoice_id: 'INV-002',
          invoice_date: '2023-01-02',
          customer_name: 'Customer B',
          total_amount: 200.0,
        }),
        financialRecordFactory.invoice({
          invoice_id: 'INV-003',
          invoice_date: '2023-01-03',
          customer_name: 'Customer C',
          total_amount: 300.0,
        }),
      ];

      const response = await authenticatedRequest(app, tenant.token)
        .post('/etl/ingest')
        .send({
          source: 'csv_upload',
          entityType: 'invoice',
          records,
        })
        .expect(202);

      const jobId = response.body.jobId || response.body.id;

      await pollUntil(
        async () => {
          const status = await authenticatedRequest(app, tenant.token).get(`/etl/jobs/${jobId}`);
          return status.body.status === 'completed';
        },
        30,
        500,
      );

      // Verify all invoices were processed
      const invoices = await authenticatedRequest(app, tenant.token).get('/invoices').expect(200);

      expect(invoices.body.data).toBeDefined();
      expect(Array.isArray(invoices.body.data)).toBe(true);
      expect(invoices.body.data.length).toBeGreaterThanOrEqual(3);
    });

    it('should reject CSV upload without authentication', async () => {
      const records = [
        financialRecordFactory.invoice({
          invoice_id: 'INV-1',
          total_amount: 100.0,
        }),
      ];

      await authenticatedRequest(app, 'invalid-token')
        .post('/etl/ingest')
        .send({
          source: 'csv_upload',
          entityType: 'invoice',
          records,
        })
        .expect(401);
    });

    it('should validate required fields in CSV records', async () => {
      const tenant = await createTenantWithUser('validate@test.com', 'ADMIN');

      // Record with missing customer_name
      const records = [
        {
          invoice_id: 'INV-1',
          invoice_date: '2023-01-01',
          total_amount: 100.0,
          // missing customer_name
        },
      ];

      const response = await authenticatedRequest(app, tenant.token).post('/etl/ingest').send({
        source: 'csv_upload',
        entityType: 'invoice',
        records,
      });

      // Should either reject immediately (400/422) or accept and quarantine
      expect([202, 400, 422]).toContain(response.status);

      if (response.status === 202) {
        const jobId = response.body.jobId || response.body.id;

        await pollUntil(
          async () => {
            const status = await authenticatedRequest(app, tenant.token).get(`/etl/jobs/${jobId}`);
            return ['completed', 'failed'].includes(status.body.status);
          },
          30,
          500,
        );

        // Should be in quarantine
        const quarantine = await authenticatedRequest(app, tenant.token)
          .get('/etl/quarantine')
          .expect(200);

        expect(quarantine.body.data.length).toBeGreaterThan(0);
      }
    });
  });

  describe('GET /etl/jobs/:jobId', () => {
    it('should return job status for valid job ID', async () => {
      const tenant = await createTenantWithUser('jobstatus@test.com', 'ADMIN');

      const records = [
        financialRecordFactory.invoice({
          invoice_id: 'INV-STATUS',
          total_amount: 100.0,
        }),
      ];

      const uploadResponse = await authenticatedRequest(app, tenant.token)
        .post('/etl/ingest')
        .send({
          source: 'csv_upload',
          entityType: 'invoice',
          records,
        })
        .expect(202);

      const jobId = uploadResponse.body.jobId || uploadResponse.body.id;

      const response = await authenticatedRequest(app, tenant.token)
        .get(`/etl/jobs/${jobId}`)
        .expect(200);

      expect(response.body).toHaveProperty('status');
      expect(['pending', 'processing', 'completed', 'failed']).toContain(response.body.status);
    });

    it('should return 404 for non-existent job ID', async () => {
      const tenant = await createTenantWithUser('notfound@test.com', 'ADMIN');

      const fakeJobId = '00000000-0000-0000-0000-000000000000';

      await authenticatedRequest(app, tenant.token).get(`/etl/jobs/${fakeJobId}`).expect(404);
    });
  });
});
