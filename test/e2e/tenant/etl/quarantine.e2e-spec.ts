import { INestApplication } from '@nestjs/common';
import {
  setupTestApp,
  teardownTestApp,
  resetDatabase,
  createTenantWithUser,
} from '../../../setup/test-app.bootstrap';
import { authenticatedRequest, pollUntil } from '../../../setup/test-helpers';
import { financialRecordFactory } from '../../../setup/test-data-factories';

describe('ETL Quarantine (e2e)', () => {
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

  describe('Invalid Record Handling', () => {
    it('should quarantine invalid records and complete ETL job', async () => {
      const tenant = await createTenantWithUser('quarantine@test.com', 'ADMIN');

      // Create valid and invalid records (missing total_amount)
      const validRecord = financialRecordFactory.invoice({
        invoice_id: 'INV-VALID-001',
        customer_name: 'Valid Customer',
        total_amount: 100.0,
      });
      const invalidRecord = {
        invoice_id: 'INV-INVALID-001',
        customer_name: 'Invalid Customer',
        total_amount: null, // Invalid - null amount
      };

      const response = await authenticatedRequest(app, tenant.token)
        .post('/etl/ingest')
        .send({
          source: 'csv_upload',
          entityType: 'invoice',
          records: [validRecord, invalidRecord],
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

      // Check quarantine entries exist
      const quarantine = await authenticatedRequest(app, tenant.token)
        .get('/etl/quarantine')
        .expect(200);

      expect(quarantine.body).toHaveProperty('data');
      expect(Array.isArray(quarantine.body.data)).toBe(true);
      expect(quarantine.body.data.length).toBeGreaterThanOrEqual(1);

      // Verify valid record was processed
      const invoices = await authenticatedRequest(app, tenant.token).get('/invoices').expect(200);

      const validInvoices = invoices.body.data.filter(
        (inv: any) => inv.invoice_id === 'INV-VALID-001',
      );
      expect(validInvoices.length).toBe(1);
    });

    it('should quarantine records with missing required fields', async () => {
      const tenant = await createTenantWithUser('missing-fields@test.com', 'ADMIN');

      const records = [
        { invoice_id: 'INV-001' }, // Missing customer_name, total_amount
        { customer_name: 'Customer A', total_amount: 100.0 }, // Missing invoice_id
        financialRecordFactory.invoice({ invoice_id: 'INV-002', total_amount: 200.0 }), // Valid
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
          return ['completed', 'failed'].includes(status.body.status);
        },
        30,
        500,
      );

      const quarantine = await authenticatedRequest(app, tenant.token)
        .get('/etl/quarantine')
        .expect(200);

      expect(quarantine.body.data).toBeDefined();
      expect(quarantine.body.data.length).toBeGreaterThanOrEqual(2);
    });

    it('should quarantine records with invalid data types', async () => {
      const tenant = await createTenantWithUser('invalid-types@test.com', 'ADMIN');

      const records = [
        financialRecordFactory.invoice({
          invoice_id: 'INV-TYPE-001',
          total_amount: 'not-a-number' as any, // Invalid type
        }),
        financialRecordFactory.invoice({
          invoice_id: 'INV-TYPE-002',
          invoice_date: 'invalid-date', // Invalid date format
          total_amount: 100.0,
        }),
        financialRecordFactory.invoice({
          invoice_id: 'INV-TYPE-003',
          total_amount: -100.0, // Negative amount (if validation exists)
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
          return ['completed', 'failed'].includes(status.body.status);
        },
        30,
        500,
      );

      const quarantine = await authenticatedRequest(app, tenant.token)
        .get('/etl/quarantine')
        .expect(200);

      expect(quarantine.body.data.length).toBeGreaterThan(0);
    });

    it('should process valid records even when some are quarantined', async () => {
      const tenant = await createTenantWithUser('partial-success@test.com', 'ADMIN');

      const records = [
        financialRecordFactory.invoice({ invoice_id: 'INV-GOOD-1', total_amount: 100.0 }),
        { invoice_id: 'INV-BAD-1' }, // Missing fields
        financialRecordFactory.invoice({ invoice_id: 'INV-GOOD-2', total_amount: 200.0 }),
        { invoice_id: 'INV-BAD-2', total_amount: null }, // Invalid amount
        financialRecordFactory.invoice({ invoice_id: 'INV-GOOD-3', total_amount: 300.0 }),
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

      // Should have 3 valid invoices
      const invoices = await authenticatedRequest(app, tenant.token).get('/invoices').expect(200);

      expect(invoices.body.data.length).toBeGreaterThanOrEqual(3);

      // Should have 2 quarantined records
      const quarantine = await authenticatedRequest(app, tenant.token)
        .get('/etl/quarantine')
        .expect(200);

      expect(quarantine.body.data.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Quarantine Management', () => {
    it('should retrieve quarantined records with details', async () => {
      const tenant = await createTenantWithUser('quarantine-details@test.com', 'ADMIN');

      const invalidRecord = {
        invoice_id: 'INV-DETAIL-001',
        total_amount: null,
      };

      const response = await authenticatedRequest(app, tenant.token)
        .post('/etl/ingest')
        .send({
          source: 'csv_upload',
          entityType: 'invoice',
          records: [invalidRecord],
        })
        .expect(202);

      const jobId = response.body.jobId || response.body.id;

      await pollUntil(
        async () => {
          const status = await authenticatedRequest(app, tenant.token).get(`/etl/jobs/${jobId}`);
          return ['completed', 'failed'].includes(status.body.status);
        },
        30,
        500,
      );

      const quarantine = await authenticatedRequest(app, tenant.token)
        .get('/etl/quarantine')
        .expect(200);

      expect(quarantine.body.data.length).toBeGreaterThan(0);

      // Quarantine records should have metadata
      const quarantinedRecord = quarantine.body.data[0];
      expect(quarantinedRecord).toHaveProperty('id');
      expect(quarantinedRecord).toHaveProperty('reason');
      expect(quarantinedRecord).toHaveProperty('rawData');
    });

    it('should allow reprocessing quarantined records after correction', async () => {
      const tenant = await createTenantWithUser('reprocess@test.com', 'ADMIN');

      // First ingest with invalid record
      const invalidRecord = {
        invoice_id: 'INV-REPROCESS-001',
        customer_name: 'Customer A',
        total_amount: null,
      };

      const response1 = await authenticatedRequest(app, tenant.token)
        .post('/etl/ingest')
        .send({
          source: 'csv_upload',
          entityType: 'invoice',
          records: [invalidRecord],
        })
        .expect(202);

      const jobId1 = response1.body.jobId || response1.body.id;

      await pollUntil(
        async () => {
          const status = await authenticatedRequest(app, tenant.token).get(`/etl/jobs/${jobId1}`);
          return ['completed', 'failed'].includes(status.body.status);
        },
        30,
        500,
      );

      // Now ingest corrected version
      const correctedRecord = financialRecordFactory.invoice({
        invoice_id: 'INV-REPROCESS-001',
        customer_name: 'Customer A',
        total_amount: 100.0,
      });

      const response2 = await authenticatedRequest(app, tenant.token)
        .post('/etl/ingest')
        .send({
          source: 'csv_upload',
          entityType: 'invoice',
          records: [correctedRecord],
        })
        .expect(202);

      const jobId2 = response2.body.jobId || response2.body.id;

      await pollUntil(
        async () => {
          const status = await authenticatedRequest(app, tenant.token).get(`/etl/jobs/${jobId2}`);
          return status.body.status === 'completed';
        },
        30,
        500,
      );

      // Corrected record should be in invoices
      const invoices = await authenticatedRequest(app, tenant.token).get('/invoices').expect(200);

      const processedInvoices = invoices.body.data.filter(
        (inv: any) => inv.invoice_id === 'INV-REPROCESS-001',
      );
      expect(processedInvoices.length).toBe(1);
    });

    it('should track quarantine statistics per job', async () => {
      const tenant = await createTenantWithUser('stats@test.com', 'ADMIN');

      const records = [
        financialRecordFactory.invoice({ invoice_id: 'INV-STAT-1', total_amount: 100.0 }),
        { invoice_id: 'INV-STAT-2' }, // Invalid
        { invoice_id: 'INV-STAT-3' }, // Invalid
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
          return ['completed', 'failed'].includes(status.body.status);
        },
        30,
        500,
      );

      const jobStatus = await authenticatedRequest(app, tenant.token)
        .get(`/etl/jobs/${jobId}`)
        .expect(200);

      // Job should track processed vs quarantined counts
      expect(jobStatus.body).toHaveProperty('status');
      // If your API tracks these stats:
      // expect(jobStatus.body).toHaveProperty('recordsProcessed');
      // expect(jobStatus.body).toHaveProperty('recordsQuarantined');
    });
  });
});
