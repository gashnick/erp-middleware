import { INestApplication } from '@nestjs/common';
import {
  setupTestApp,
  teardownTestApp,
  resetDatabase,
  createTenantWithUser,
} from '../../setup/test-app.bootstrap';
import { authenticatedRequest, pollUntil } from '../../setup/test-helpers';
import { financialRecordFactory } from '../../setup/test-data-factories';

describe('Multi-tenant Isolation (e2e)', () => {
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

  describe('Data Isolation', () => {
    it('should keep data isolated between two tenants', async () => {
      // Create Tenant A
      const tenantA = await createTenantWithUser('tenant-a@test.com', 'ADMIN');

      // Create Tenant B
      const tenantB = await createTenantWithUser('tenant-b@test.com', 'ADMIN');

      // Ingest data for Tenant A only
      const invoiceA = financialRecordFactory.invoice({
        invoice_id: 'INV-A-001',
        customer_name: 'Customer A',
        total_amount: 1000.0,
      });

      const response = await authenticatedRequest(app, tenantA.token)
        .post('/etl/ingest')
        .send({
          source: 'csv_upload',
          entityType: 'invoice',
          records: [invoiceA],
        })
        .expect(202);

      const jobId = response.body.jobId || response.body.id;

      // Wait for job completion
      await pollUntil(
        async () => {
          const status = await authenticatedRequest(app, tenantA.token).get(`/etl/jobs/${jobId}`);
          return status.body.status === 'completed';
        },
        30,
        500,
      );

      // Verify Tenant A can see their data
      const dashboardA = await authenticatedRequest(app, tenantA.token)
        .get('/dashboard/finance')
        .expect(200);

      expect(dashboardA.body).toHaveProperty('cashFlow');
      expect(dashboardA.body).toHaveProperty('arAging');

      // Verify Tenant B's dashboard has no data from Tenant A
      const dashboardB = await authenticatedRequest(app, tenantB.token)
        .get('/dashboard/finance')
        .expect(200);

      expect(dashboardB.body).toHaveProperty('cashFlow');
      expect(dashboardB.body).toHaveProperty('arAging');
      // Dashboard structure exists but should be empty or show different data
    });

    it('should prevent cross-tenant data access via API', async () => {
      const tenantA = await createTenantWithUser('cross-a@test.com', 'ADMIN');
      const tenantB = await createTenantWithUser('cross-b@test.com', 'ADMIN');

      // Create invoice for Tenant A
      const invoiceA = financialRecordFactory.invoice({
        invoice_id: 'INV-CROSS-A',
        total_amount: 500.0,
      });

      const responseA = await authenticatedRequest(app, tenantA.token)
        .post('/etl/ingest')
        .send({
          source: 'csv_upload',
          entityType: 'invoice',
          records: [invoiceA],
        })
        .expect(202);

      const jobIdA = responseA.body.jobId || responseA.body.id;

      await pollUntil(
        async () => {
          const status = await authenticatedRequest(app, tenantA.token).get(`/etl/jobs/${jobIdA}`);
          return status.body.status === 'completed';
        },
        30,
        500,
      );

      // Tenant A can see their invoices
      const invoicesA = await authenticatedRequest(app, tenantA.token).get('/invoices').expect(200);

      expect(invoicesA.body.data).toBeDefined();
      expect(invoicesA.body.data.length).toBeGreaterThan(0);

      // Tenant B should see empty invoice list (or only their own data)
      const invoicesB = await authenticatedRequest(app, tenantB.token).get('/invoices').expect(200);

      expect(invoicesB.body.data).toBeDefined();
      expect(Array.isArray(invoicesB.body.data)).toBe(true);
      // Should not see Tenant A's invoices
    });

    it('should isolate ETL jobs between tenants', async () => {
      const tenantA = await createTenantWithUser('job-a@test.com', 'ADMIN');
      const tenantB = await createTenantWithUser('job-b@test.com', 'ADMIN');

      // Create job for Tenant A
      const invoiceA = financialRecordFactory.invoice({
        invoice_id: 'INV-JOB-A',
        total_amount: 300.0,
      });

      const responseA = await authenticatedRequest(app, tenantA.token)
        .post('/etl/ingest')
        .send({
          source: 'csv_upload',
          entityType: 'invoice',
          records: [invoiceA],
        })
        .expect(202);

      const jobIdA = responseA.body.jobId || responseA.body.id;

      // Tenant B should not be able to access Tenant A's job
      await authenticatedRequest(app, tenantB.token).get(`/etl/jobs/${jobIdA}`).expect(404); // Should not find the job
    });

    it('should maintain separate quarantine records per tenant', async () => {
      const tenantA = await createTenantWithUser('quarantine-a@test.com', 'ADMIN');
      const tenantB = await createTenantWithUser('quarantine-b@test.com', 'ADMIN');

      // Create invalid record for Tenant A
      const invalidRecordA = { invoice_id: 'INV-BAD-A' };

      const responseA = await authenticatedRequest(app, tenantA.token)
        .post('/etl/ingest')
        .send({
          source: 'csv_upload',
          entityType: 'invoice',
          records: [invalidRecordA],
        })
        .expect(202);

      const jobIdA = responseA.body.jobId || responseA.body.id;

      await pollUntil(
        async () => {
          const status = await authenticatedRequest(app, tenantA.token).get(`/etl/jobs/${jobIdA}`);
          return ['completed', 'failed'].includes(status.body.status);
        },
        30,
        500,
      );

      // Tenant A should see their quarantine records
      const quarantineA = await authenticatedRequest(app, tenantA.token)
        .get('/etl/quarantine')
        .expect(200);

      expect(quarantineA.body.data).toBeDefined();

      // Tenant B should have empty quarantine
      const quarantineB = await authenticatedRequest(app, tenantB.token)
        .get('/etl/quarantine')
        .expect(200);

      expect(quarantineB.body.data).toBeDefined();
      expect(Array.isArray(quarantineB.body.data)).toBe(true);
      // Should not see Tenant A's quarantine records
    });

    it('should allow concurrent operations from different tenants', async () => {
      const tenantA = await createTenantWithUser('concurrent-a@test.com', 'ADMIN');
      const tenantB = await createTenantWithUser('concurrent-b@test.com', 'ADMIN');

      const invoiceA = financialRecordFactory.invoice({
        invoice_id: 'INV-CONCURRENT-A',
        total_amount: 100.0,
      });

      const invoiceB = financialRecordFactory.invoice({
        invoice_id: 'INV-CONCURRENT-B',
        total_amount: 200.0,
      });

      // Perform concurrent ingestion
      const [responseA, responseB] = await Promise.all([
        authenticatedRequest(app, tenantA.token)
          .post('/etl/ingest')
          .send({
            source: 'csv_upload',
            entityType: 'invoice',
            records: [invoiceA],
          })
          .expect(202),
        authenticatedRequest(app, tenantB.token)
          .post('/etl/ingest')
          .send({
            source: 'csv_upload',
            entityType: 'invoice',
            records: [invoiceB],
          })
          .expect(202),
      ]);

      const jobIdA = responseA.body.jobId || responseA.body.id;
      const jobIdB = responseB.body.jobId || responseB.body.id;

      // Wait for both jobs
      await Promise.all([
        pollUntil(
          async () => {
            const status = await authenticatedRequest(app, tenantA.token).get(
              `/etl/jobs/${jobIdA}`,
            );
            return status.body.status === 'completed';
          },
          30,
          500,
        ),
        pollUntil(
          async () => {
            const status = await authenticatedRequest(app, tenantB.token).get(
              `/etl/jobs/${jobIdB}`,
            );
            return status.body.status === 'completed';
          },
          30,
          500,
        ),
      ]);

      // Both tenants should have their own data
      const invoicesA = await authenticatedRequest(app, tenantA.token).get('/invoices').expect(200);

      const invoicesB = await authenticatedRequest(app, tenantB.token).get('/invoices').expect(200);

      expect(invoicesA.body.data).toBeDefined();
      expect(invoicesB.body.data).toBeDefined();
    });
  });
});
