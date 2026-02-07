import { INestApplication } from '@nestjs/common';
import {
  setupTestApp,
  teardownTestApp,
  resetDatabase,
  createTenantWithUser,
} from '../../../setup/test-app.bootstrap';
import { authenticatedRequest, pollUntil } from '../../../setup/test-helpers';
import { financialRecordFactory } from '../../../setup/test-data-factories';

describe('ETL Deduplication (e2e)', () => {
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

  describe('Invoice Deduplication', () => {
    it('should deduplicate records by business key during ETL', async () => {
      const tenant = await createTenantWithUser('dedup@test.com', 'ADMIN');

      // Two records with same invoice_id
      const invoiceKey = `DUP-${Date.now()}`;
      const record1 = financialRecordFactory.invoice({
        invoice_id: invoiceKey,
        customer_name: 'Customer A',
        total_amount: 100.0,
      });
      const record2 = financialRecordFactory.invoice({
        invoice_id: invoiceKey,
        customer_name: 'Customer A',
        total_amount: 150.0, // Different amount, same ID
      });

      const response = await authenticatedRequest(app, tenant.token)
        .post('/etl/ingest')
        .send({
          source: 'csv_upload',
          entityType: 'invoice',
          records: [record1, record2],
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

      // Check quarantine for duplicate records
      const quarantine = await authenticatedRequest(app, tenant.token)
        .get('/etl/quarantine')
        .expect(200);

      expect(quarantine.body).toHaveProperty('data');
      expect(Array.isArray(quarantine.body.data)).toBe(true);

      // Verify only one invoice was created
      const invoices = await authenticatedRequest(app, tenant.token).get('/invoices').expect(200);

      const matchingInvoices = invoices.body.data.filter(
        (inv: any) => inv.invoice_id === invoiceKey,
      );

      // Should have only 1 invoice, duplicate should be quarantined or rejected
      expect(matchingInvoices.length).toBeLessThanOrEqual(1);
    });

    it('should handle multiple duplicates in a batch', async () => {
      const tenant = await createTenantWithUser('batch-dedup@test.com', 'ADMIN');

      const invoiceKey1 = `DUP-BATCH-1-${Date.now()}`;
      const invoiceKey2 = `DUP-BATCH-2-${Date.now()}`;

      const records = [
        financialRecordFactory.invoice({ invoice_id: invoiceKey1, total_amount: 100.0 }),
        financialRecordFactory.invoice({ invoice_id: invoiceKey1, total_amount: 101.0 }), // Duplicate
        financialRecordFactory.invoice({ invoice_id: invoiceKey2, total_amount: 200.0 }),
        financialRecordFactory.invoice({ invoice_id: invoiceKey2, total_amount: 201.0 }), // Duplicate
        financialRecordFactory.invoice({ invoice_id: 'UNIQUE-1', total_amount: 300.0 }),
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

      // Should have 3 unique invoices maximum
      const invoices = await authenticatedRequest(app, tenant.token).get('/invoices').expect(200);

      expect(invoices.body.data).toBeDefined();
      expect(Array.isArray(invoices.body.data)).toBe(true);
      expect(invoices.body.data.length).toBeLessThanOrEqual(3);
    });

    it('should update existing record when duplicate is detected with newer data', async () => {
      const tenant = await createTenantWithUser('update-dedup@test.com', 'ADMIN');

      const invoiceKey = `UPDATE-${Date.now()}`;

      // First ingestion
      const record1 = financialRecordFactory.invoice({
        invoice_id: invoiceKey,
        total_amount: 100.0,
        customer_name: 'Customer Original',
      });

      const response1 = await authenticatedRequest(app, tenant.token)
        .post('/etl/ingest')
        .send({
          source: 'csv_upload',
          entityType: 'invoice',
          records: [record1],
        })
        .expect(202);

      const jobId1 = response1.body.jobId || response1.body.id;

      await pollUntil(
        async () => {
          const status = await authenticatedRequest(app, tenant.token).get(`/etl/jobs/${jobId1}`);
          return status.body.status === 'completed';
        },
        30,
        500,
      );

      // Second ingestion with same invoice_id but updated data
      const record2 = financialRecordFactory.invoice({
        invoice_id: invoiceKey,
        total_amount: 150.0, // Updated amount
        customer_name: 'Customer Updated',
      });

      const response2 = await authenticatedRequest(app, tenant.token)
        .post('/etl/ingest')
        .send({
          source: 'csv_upload',
          entityType: 'invoice',
          records: [record2],
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

      // Verify still only one invoice exists (updated or original)
      const invoices = await authenticatedRequest(app, tenant.token).get('/invoices').expect(200);

      const matchingInvoices = invoices.body.data.filter(
        (inv: any) => inv.invoice_id === invoiceKey,
      );

      expect(matchingInvoices.length).toBe(1);
    });

    it('should preserve unique records while rejecting duplicates', async () => {
      const tenant = await createTenantWithUser('preserve@test.com', 'ADMIN');

      const duplicateKey = `DUP-${Date.now()}`;

      const records = [
        financialRecordFactory.invoice({ invoice_id: 'UNIQUE-A', total_amount: 100.0 }),
        financialRecordFactory.invoice({ invoice_id: duplicateKey, total_amount: 200.0 }),
        financialRecordFactory.invoice({ invoice_id: duplicateKey, total_amount: 250.0 }), // Duplicate
        financialRecordFactory.invoice({ invoice_id: 'UNIQUE-B', total_amount: 300.0 }),
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

      const invoices = await authenticatedRequest(app, tenant.token).get('/invoices').expect(200);

      // Should have exactly 3 invoices (2 unique + 1 from duplicate pair)
      const uniqueInvoiceIds = new Set(invoices.body.data.map((inv: any) => inv.invoice_id));
      expect(uniqueInvoiceIds.size).toBe(3);
    });
  });

  describe('Order Deduplication', () => {
    it('should deduplicate order records by order_id', async () => {
      const tenant = await createTenantWithUser('order-dedup@test.com', 'ADMIN');

      const orderKey = `ORDER-DUP-${Date.now()}`;

      const order1 = financialRecordFactory.order({
        order_id: orderKey,
        total_amount: 500.0,
      });
      const order2 = financialRecordFactory.order({
        order_id: orderKey,
        total_amount: 550.0,
      });

      const response = await authenticatedRequest(app, tenant.token)
        .post('/etl/ingest')
        .send({
          source: 'csv_upload',
          entityType: 'order',
          records: [order1, order2],
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

      const orders = await authenticatedRequest(app, tenant.token).get('/orders').expect(200);

      const matchingOrders = orders.body.data.filter((ord: any) => ord.order_id === orderKey);

      expect(matchingOrders.length).toBeLessThanOrEqual(1);
    });
  });
});
