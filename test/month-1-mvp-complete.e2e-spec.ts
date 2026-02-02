// test/month-1-mvp-complete.e2e-spec.ts
import * as request from 'supertest';
import {
  setupTestApp,
  teardownTestApp,
  app,
  authService,
  usersService,
  createTenantWithUser,
  resetDatabase,
  db,
} from './test-app.bootstrap';
import { UserRole } from '@users/dto/create-user.dto';
import { runWithTenantContext } from '../src/common/context/tenant-context';

describe('🚀 Month 1 MVP: Complete Integration Test Suite', () => {
  beforeAll(async () => await setupTestApp());
  beforeEach(async () => await resetDatabase());
  afterAll(async () => await teardownTestApp());

  // =============================================================================
  // 1️⃣ FOUNDATION: Tenant Provisioning & Authentication
  // =============================================================================
  describe('Foundation: Tenant Setup & Auth', () => {
    it('✅ Registers user → Provisions tenant → Upgrades session', async () => {
      // Step 1: Register new user (lobby mode)
      const registerRes = await request(app!.getHttpServer())
        .post('/auth/register')
        .send({
          email: 'newuser@test.com',
          password: 'Password123!',
          fullName: 'New User',
          role: 'ADMIN',
        })
        .expect(201);

      expect(registerRes.body).toHaveProperty('id');

      // Step 2: Login (get lobby token)
      const loginRes = await request(app!.getHttpServer())
        .post('/auth/login')
        .send({ email: 'newuser@test.com', password: 'Password123!' })
        .expect(200);

      expect(loginRes.body).toHaveProperty('access_token');
      expect(loginRes.body).toHaveProperty('refresh_token');
      const lobbyToken = loginRes.body.access_token;

      // Step 3: Setup organization (tenant provisioning)
      const setupRes = await request(app!.getHttpServer())
        .post('/tenants/setup')
        .set('Authorization', `Bearer ${lobbyToken}`)
        .send({
          companyName: 'Test Organization',
          subscriptionPlan: 'enterprise',
          dataSourceType: 'external',
        })
        .expect(201);

      expect(setupRes.body).toHaveProperty('auth');
      expect(setupRes.body.auth).toHaveProperty('access_token');
      expect(setupRes.body.auth).toHaveProperty('refresh_token');
      expect(setupRes.body.organization).toHaveProperty('id');
      expect(setupRes.body.organization.name).toBe('Test Organization');

      // Step 4: Verify upgraded token works
      const tenantToken = setupRes.body.auth.access_token;
      const tenantId = setupRes.body.organization.id;

      await request(app!.getHttpServer())
        .get('/invoices')
        .set('Authorization', `Bearer ${tenantToken}`)
        .set('x-tenant-id', tenantId)
        .expect(200);
    });

    it('✅ Login generates access + refresh token', async () => {
      await request(app!.getHttpServer())
        .post('/auth/register')
        .send({
          email: 'auth-test@test.com',
          password: 'Password123!',
          fullName: 'Auth Test User',
          role: 'ADMIN',
        })
        .expect(201);

      const loginRes = await request(app!.getHttpServer())
        .post('/auth/login')
        .send({ email: 'auth-test@test.com', password: 'Password123!' })
        .expect(200);

      expect(loginRes.body).toHaveProperty('access_token');
      expect(loginRes.body).toHaveProperty('refresh_token');
      expect(loginRes.body.user).toHaveProperty('tenantId', null); // Lobby mode
    });
  });

  // =============================================================================
  // 2️⃣ GOLDEN PATH: CSV Upload → ETL → Dashboard
  // =============================================================================
  describe('Golden Path: CSV Upload to Dashboard (60s Latency)', () => {
    it('✅ Complete Flow: Upload CSV → Validate → Encrypt → Load → Dashboard', async () => {
      const tenant = await createTenantWithUser('golden-path@test.com', 'ADMIN');

      // Create CSV file buffer
      const csvContent = Buffer.from(
        'external_id,customer_name,amount,status,invoice_number\n' +
          'INV-001,Acme Corp,1000.00,paid,QBO-12345\n' +
          'INV-002,Widget Inc,2500.50,pending,QBO-12346\n' +
          'INV-003,Tech Solutions,750.00,draft,QBO-12347',
      );

      // Step 1: Upload CSV
      const uploadStart = Date.now();
      const uploadRes = await request(app!.getHttpServer())
        .post('/connectors/csv-upload')
        .set('Authorization', `Bearer ${tenant.token}`)
        .set('x-tenant-id', tenant.id)
        .attach('file', csvContent, 'invoices.csv')
        .expect(201);

      expect(uploadRes.body).toHaveProperty('synced', 3);
      expect(uploadRes.body).toHaveProperty('quarantined', 0);
      expect(uploadRes.body.total).toBe(3);

      // Step 2: Verify data appears in invoices endpoint
      const invoicesRes = await request(app!.getHttpServer())
        .get('/invoices')
        .set('Authorization', `Bearer ${tenant.token}`)
        .set('x-tenant-id', tenant.id)
        .expect(200);

      expect(invoicesRes.body.length).toBe(3);
      expect(invoicesRes.body[0]).toHaveProperty('customer_name', 'Acme Corp');
      expect(parseFloat(invoicesRes.body[0].amount)).toBe(1000.0);

      // Step 3: Verify dashboard shows data within 60 seconds
      const dashboardRes = await request(app!.getHttpServer())
        .get('/finance/dashboard')
        .set('Authorization', `Bearer ${tenant.token}`)
        .set('x-tenant-id', tenant.id)
        .expect(200);

      const latency = Date.now() - uploadStart;
      expect(latency).toBeLessThan(60000); // 60 second requirement

      expect(dashboardRes.body.cashFlow.totalInvoiced).toBe(4250.5);
      expect(dashboardRes.body.cashFlow.totalCollected).toBe(1000.0);
      expect(dashboardRes.body.cashFlow.outstanding).toBe(3250.5);
    });

    it('✅ Quarantines invalid records with structured errors', async () => {
      const tenant = await createTenantWithUser('quarantine-test@test.com', 'ADMIN');

      // CSV with 2 valid, 3 invalid records
      const csvContent = Buffer.from(
        'external_id,customer_name,amount,status\n' +
          'INV-001,Valid Corp,1000.00,paid\n' +
          ',Missing ID,500.00,draft\n' + // Missing external_id
          'INV-003,,750.00,pending\n' + // Missing customer_name
          'INV-004,Invalid Amount,NOT_A_NUMBER,paid\n' + // Invalid amount
          'INV-005,Valid Inc,2000.00,draft',
      );

      const uploadRes = await request(app!.getHttpServer())
        .post('/connectors/csv-upload')
        .set('Authorization', `Bearer ${tenant.token}`)
        .set('x-tenant-id', tenant.id)
        .attach('file', csvContent, 'invoices.csv')
        .expect(201);

      expect(uploadRes.body.synced).toBe(2);
      expect(uploadRes.body.quarantined).toBe(3);

      // Verify quarantine records
      const quarantineRes = await request(app!.getHttpServer())
        .get('/quarantine')
        .set('Authorization', `Bearer ${tenant.token}`)
        .set('x-tenant-id', tenant.id)
        .expect(200);

      expect(quarantineRes.body.data).toHaveLength(3);
      const errors = quarantineRes.body.data[0].errors;
      // errors is stored as JSONB, may come back as object or string
      const errorsArray = typeof errors === 'string' ? JSON.parse(errors) : errors;
      expect(Array.isArray(errorsArray)).toBe(true);
      expect(errorsArray.length).toBeGreaterThan(0);
    });
  });

  // =============================================================================
  // 3️⃣ ETL: Quarantine & Retry Workflow
  // =============================================================================
  describe('ETL: Quarantine & Retry', () => {
    it('✅ Lists quarantined records with error details', async () => {
      const tenant = await createTenantWithUser('quarantine-list@test.com', 'ADMIN');

      // Upload invalid data
      const csvContent = Buffer.from(
        'external_id,customer_name,amount,status\n' +
          ',Bad Record 1,100,draft\n' +
          'INV-002,,200,paid',
      );

      await request(app!.getHttpServer())
        .post('/connectors/csv-upload')
        .set('Authorization', `Bearer ${tenant.token}`)
        .set('x-tenant-id', tenant.id)
        .attach('file', csvContent, 'bad.csv')
        .expect(201);

      const quarantineRes = await request(app!.getHttpServer())
        .get('/quarantine')
        .set('Authorization', `Bearer ${tenant.token}`)
        .set('x-tenant-id', tenant.id)
        .expect(200);

      expect(quarantineRes.body.data).toHaveLength(2);
      expect(quarantineRes.body.data[0]).toHaveProperty('source_type', 'csv_upload');
      expect(quarantineRes.body.data[0]).toHaveProperty('errors');
      expect(quarantineRes.body.data[0]).toHaveProperty('raw_data');
    });

    it('✅ Retries fixed record successfully', async () => {
      const tenant = await createTenantWithUser('retry-test@test.com', 'ADMIN');

      // Step 1: Upload bad data to create quarantine record
      const badCsv = Buffer.from(
        'external_id,customer_name,amount,status\n' + ',Missing ID,100,draft', // Missing external_id
      );

      const uploadRes = await request(app!.getHttpServer())
        .post('/connectors/csv-upload')
        .set('Authorization', `Bearer ${tenant.token}`)
        .set('x-tenant-id', tenant.id)
        .attach('file', badCsv, 'bad.csv')
        .expect(201);

      expect(uploadRes.body.quarantined).toBe(1);

      // Step 2: Get the quarantine record ID
      const quarantineRes = await request(app!.getHttpServer())
        .get('/quarantine')
        .set('Authorization', `Bearer ${tenant.token}`)
        .set('x-tenant-id', tenant.id)
        .expect(200);

      expect(quarantineRes.body.data.length).toBe(1);
      const recordId = quarantineRes.body.data[0].id;

      // Step 3: Retry with fixed data
      const fixedData = {
        external_id: 'FIXED-001',
        customer_name: 'Fixed Customer',
        amount: '100.00',
        status: 'draft',
      };

      const retryRes = await request(app!.getHttpServer())
        .post(`/quarantine/${recordId}/retry`)
        .set('Authorization', `Bearer ${tenant.token}`)
        .set('x-tenant-id', tenant.id)
        .send({ fixedData })
        .expect(200);

      expect(retryRes.body.success).toBe(true);
      expect(retryRes.body.invoice).toHaveProperty('external_id', 'FIXED-001');

      // Step 4: Verify record moved from quarantine to invoices
      const invoicesRes = await request(app!.getHttpServer())
        .get('/invoices')
        .set('Authorization', `Bearer ${tenant.token}`)
        .set('x-tenant-id', tenant.id)
        .expect(200);

      expect(invoicesRes.body.length).toBe(1);
      expect(invoicesRes.body[0].external_id).toBe('FIXED-001');

      // Step 5: Verify quarantine is now empty
      const emptyQuarantine = await request(app!.getHttpServer())
        .get('/quarantine')
        .set('Authorization', `Bearer ${tenant.token}`)
        .set('x-tenant-id', tenant.id)
        .expect(200);

      expect(emptyQuarantine.body.data).toHaveLength(0);
    });
  });

  // =============================================================================
  // 4️⃣ CONNECTOR MANAGEMENT: CRUD Operations
  // =============================================================================
  describe('Connectors: CRUD & Status', () => {
    it('✅ Lists available connectors (empty by default)', async () => {
      const tenant = await createTenantWithUser('connector-list@test.com', 'ADMIN');

      const res = await request(app!.getHttpServer())
        .get('/connectors')
        .set('Authorization', `Bearer ${tenant.token}`)
        .set('x-tenant-id', tenant.id)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(0); // No connectors created yet
    });

    it('✅ Creates new connector (ADMIN only)', async () => {
      const admin = await createTenantWithUser('connector-create@test.com', 'ADMIN');

      const connectorRes = await request(app!.getHttpServer())
        .post('/connectors')
        .set('Authorization', `Bearer ${admin.token}`)
        .set('x-tenant-id', admin.id)
        .send({
          type: 'quickbooks',
          name: 'QuickBooks Production',
          config: { clientId: 'test123', realmId: 'realm456' },
        })
        .expect(201);

      expect(connectorRes.body).toHaveProperty('id');
      expect(connectorRes.body.status).toBe('active');
      expect(connectorRes.body.tenantId).toBe(admin.id);
    });

    it('✅ Gets connector status with retry metadata', async () => {
      const admin = await createTenantWithUser('connector-status@test.com', 'ADMIN');

      const connectorRes = await request(app!.getHttpServer())
        .post('/connectors')
        .set('Authorization', `Bearer ${admin.token}`)
        .set('x-tenant-id', admin.id)
        .send({ type: 'postgres', name: 'Test DB' })
        .expect(201);

      const statusRes = await request(app!.getHttpServer())
        .get(`/connectors/${connectorRes.body.id}`)
        .set('Authorization', `Bearer ${admin.token}`)
        .set('x-tenant-id', admin.id)
        .expect(200);

      expect(statusRes.body).toHaveProperty('id', connectorRes.body.id);
      expect(statusRes.body).toHaveProperty('status');
      expect(statusRes.body).toHaveProperty('retry_count');
    });

    it('✅ Deletes connector (ADMIN only)', async () => {
      const admin = await createTenantWithUser('connector-delete@test.com', 'ADMIN');

      const connectorRes = await request(app!.getHttpServer())
        .post('/connectors')
        .set('Authorization', `Bearer ${admin.token}`)
        .set('x-tenant-id', admin.id)
        .send({ type: 'csv', name: 'Test CSV' })
        .expect(201);

      await request(app!.getHttpServer())
        .delete(`/connectors/${connectorRes.body.id}`)
        .set('Authorization', `Bearer ${admin.token}`)
        .set('x-tenant-id', admin.id)
        .expect(200);
    });

    it('✅ Returns connector health status (ADMIN only)', async () => {
      const admin = await createTenantWithUser('connector-health@test.com', 'ADMIN');

      const statusRes = await request(app!.getHttpServer())
        .get('/connectors/status')
        .set('Authorization', `Bearer ${admin.token}`)
        .set('x-tenant-id', admin.id)
        .expect(200);

      expect(statusRes.body).toHaveProperty('tenantId');
      expect(statusRes.body).toHaveProperty('connectors');
      expect(Array.isArray(statusRes.body.connectors)).toBe(true);
    });
  });

  // =============================================================================
  // 5️⃣ CONNECTOR RESILIENCE: Retry & Exponential Backoff
  // =============================================================================
  describe('Connectors: Retry & Exponential Backoff', () => {
    it('✅ Handles sync failure with exponential backoff', async () => {
      const admin = await createTenantWithUser('backoff-test@test.com', 'ADMIN');

      // Create connector
      const connectorRes = await request(app!.getHttpServer())
        .post('/connectors')
        .set('Authorization', `Bearer ${admin.token}`)
        .set('x-tenant-id', admin.id)
        .send({ type: 'quickbooks', name: 'Failing Connector' })
        .expect(201);

      const connectorId = connectorRes.body.id;

      // Trigger sync with simulated failure
      try {
        await request(app!.getHttpServer())
          .post(`/connectors/${connectorId}/sync`)
          .set('Authorization', `Bearer ${admin.token}`)
          .set('x-tenant-id', admin.id)
          .send({ simulateFailure: true })
          .expect(500);
      } catch (e) {
        // Expected to fail
      }

      // Check status - should have incremented retry count
      const statusRes = await request(app!.getHttpServer())
        .get(`/connectors/${connectorId}`)
        .set('Authorization', `Bearer ${admin.token}`)
        .set('x-tenant-id', admin.id)
        .expect(200);

      expect(statusRes.body.status).toBe('error');
      expect(statusRes.body.retry_count).toBeGreaterThanOrEqual(1);
      expect(statusRes.body).toHaveProperty('next_sync_at');

      // Verify exponential backoff (next_sync should be in the future)
      const nextSync = new Date(statusRes.body.next_sync_at);
      const now = new Date();
      expect(nextSync.getTime()).toBeGreaterThan(now.getTime());
    });

    it('✅ Triggers sync successfully and resets retry count', async () => {
      const admin = await createTenantWithUser('sync-success@test.com', 'ADMIN');

      const connectorRes = await request(app!.getHttpServer())
        .post('/connectors')
        .set('Authorization', `Bearer ${admin.token}`)
        .set('x-tenant-id', admin.id)
        .send({ type: 'csv', name: 'Healthy Connector' })
        .expect(201);

      const syncRes = await request(app!.getHttpServer())
        .post(`/connectors/${connectorRes.body.id}/sync`)
        .set('Authorization', `Bearer ${admin.token}`)
        .set('x-tenant-id', admin.id)
        .send({ simulateFailure: false })
        .expect(201);

      expect(syncRes.body).toHaveProperty('status', 'sync_started');
      expect(syncRes.body).toHaveProperty('connectorId', connectorRes.body.id);
    });
  });

  // =============================================================================
  // 6️⃣ FINANCE DASHBOARD: Analytics Endpoints
  // =============================================================================
  describe('Finance: Dashboard Analytics', () => {
    it('✅ Calculates cash flow correctly', async () => {
      const tenant = await createTenantWithUser('dashboard-cashflow@test.com', 'ADMIN');

      // Upload sample data
      const csvContent = Buffer.from(
        'external_id,customer_name,amount,status\n' +
          'INV-001,Customer A,1000.00,paid\n' +
          'INV-002,Customer B,2000.00,paid\n' +
          'INV-003,Customer C,1500.00,pending\n' +
          'INV-004,Customer D,500.00,draft',
      );

      await request(app!.getHttpServer())
        .post('/connectors/csv-upload')
        .set('Authorization', `Bearer ${tenant.token}`)
        .set('x-tenant-id', tenant.id)
        .attach('file', csvContent, 'invoices.csv')
        .expect(201);

      const dashboardRes = await request(app!.getHttpServer())
        .get('/finance/dashboard')
        .set('Authorization', `Bearer ${tenant.token}`)
        .set('x-tenant-id', tenant.id)
        .expect(200);

      expect(dashboardRes.body.cashFlow).toMatchObject({
        totalInvoiced: 5000.0,
        totalCollected: 3000.0,
        outstanding: 2000.0,
      });
    });

    it('✅ Computes AR aging buckets (30/60/90 days)', async () => {
      const tenant = await createTenantWithUser('dashboard-aging@test.com', 'ADMIN');

      // Create invoices with different due dates
      const now = new Date();
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);

      await runWithTenantContext(
        { tenantId: tenant.id, userId: tenant.user.id, schemaName: tenant.schemaName },
        async () => {
          const runner = await db.getRunner();
          try {
            await runner.query(
              `INSERT INTO "${tenant.schemaName}"."invoices" 
               (tenant_id, external_id, customer_name, amount, status, due_date) 
               VALUES 
               ($1, 'INV-CURRENT', 'Current Corp', 1000, 'pending', $2),
               ($1, 'INV-30', 'Overdue30 Inc', 2000, 'pending', $3),
               ($1, 'INV-60', 'Overdue60 LLC', 3000, 'pending', $4)`,
              [
                tenant.id,
                now.toISOString(),
                thirtyDaysAgo.toISOString(),
                sixtyDaysAgo.toISOString(),
              ],
            );
          } finally {
            await runner.release();
          }
        },
      );

      const dashboardRes = await request(app!.getHttpServer())
        .get('/finance/dashboard')
        .set('Authorization', `Bearer ${tenant.token}`)
        .set('x-tenant-id', tenant.id)
        .expect(200);

      expect(dashboardRes.body.agingReport).toBeDefined();
      expect(dashboardRes.body.agingReport).toHaveProperty('current');
      expect(dashboardRes.body.agingReport).toHaveProperty('overdue30');
      expect(dashboardRes.body.agingReport).toHaveProperty('overdue60');
      expect(dashboardRes.body.agingReport).toHaveProperty('overdue90');
    });

    it('✅ Counts recent anomalies (quarantine records)', async () => {
      const tenant = await createTenantWithUser('dashboard-anomalies@test.com', 'ADMIN');

      // Upload bad data
      const csvContent = Buffer.from(
        'external_id,customer_name,amount,status\n' + ',Bad 1,100,draft\n' + ',Bad 2,200,paid',
      );

      await request(app!.getHttpServer())
        .post('/connectors/csv-upload')
        .set('Authorization', `Bearer ${tenant.token}`)
        .set('x-tenant-id', tenant.id)
        .attach('file', csvContent, 'bad.csv')
        .expect(201);

      const dashboardRes = await request(app!.getHttpServer())
        .get('/finance/dashboard')
        .set('Authorization', `Bearer ${tenant.token}`)
        .set('x-tenant-id', tenant.id)
        .expect(200);

      expect(dashboardRes.body.recentAnomaliesCount).toBe(2);
    });
  });

  // =============================================================================
  // 7️⃣ RBAC: Connector Access Control
  // =============================================================================
  describe('Security: Connector RBAC', () => {
    it('✅ ANALYST can view connectors list', async () => {
      const analyst = await createTenantWithUser('rbac-analyst@test.com', 'ANALYST');

      await request(app!.getHttpServer())
        .get('/connectors')
        .set('Authorization', `Bearer ${analyst.token}`)
        .set('x-tenant-id', analyst.id)
        .expect(200);
    });

    it('✅ ADMIN can upload CSV', async () => {
      const admin = await createTenantWithUser('rbac-admin-upload@test.com', 'ADMIN');

      const csvContent = Buffer.from(
        'external_id,customer_name,amount,status\n' + 'INV-001,Test Corp,1000,paid',
      );

      await request(app!.getHttpServer())
        .post('/connectors/csv-upload')
        .set('Authorization', `Bearer ${admin.token}`)
        .set('x-tenant-id', admin.id)
        .attach('file', csvContent, 'test.csv')
        .expect(201);
    });

    it('✅ ADMIN can create and delete connectors', async () => {
      const admin = await createTenantWithUser('rbac-admin@test.com', 'ADMIN');

      // Create
      const createRes = await request(app!.getHttpServer())
        .post('/connectors')
        .set('Authorization', `Bearer ${admin.token}`)
        .set('x-tenant-id', admin.id)
        .send({ type: 'csv', name: 'Admin Connector' })
        .expect(201);

      // Delete
      await request(app!.getHttpServer())
        .delete(`/connectors/${createRes.body.id}`)
        .set('Authorization', `Bearer ${admin.token}`)
        .set('x-tenant-id', admin.id)
        .expect(200);
    });

    it('❌ STAFF denied from connector management', async () => {
      const admin = await createTenantWithUser('rbac-staff-admin@test.com', 'ADMIN');

      const staff = await usersService.create(admin.id, {
        email: 'staff-user@test.com',
        password: 'Password123!',
        fullName: 'Staff User',
        role: UserRole.STAFF,
      });

      const staffSession = await authService.generateTenantSession(staff.id);

      // Try to create connector - should be denied
      await request(app!.getHttpServer())
        .post('/connectors')
        .set('Authorization', `Bearer ${staffSession.access_token}`)
        .set('x-tenant-id', admin.id)
        .send({ type: 'csv', name: 'Unauthorized' })
        .expect(403);
    });
  });

  // =============================================================================
  // 8️⃣ IDEMPOTENCY & CONCURRENCY
  // =============================================================================
  describe('ETL: Idempotency & Race Conditions', () => {
    it('✅ Prevents duplicate external_ids (409)', async () => {
      const tenant = await createTenantWithUser('idempotency@test.com', 'ADMIN');

      const payload = {
        amount: 1000,
        customer_name: 'Test Corp',
        external_id: 'UNIQUE-123',
        currency: 'USD',
        status: 'draft',
      };

      await request(app!.getHttpServer())
        .post('/invoices')
        .set('Authorization', `Bearer ${tenant.token}`)
        .set('x-tenant-id', tenant.id)
        .send(payload)
        .expect(201);

      await request(app!.getHttpServer())
        .post('/invoices')
        .set('Authorization', `Bearer ${tenant.token}`)
        .set('x-tenant-id', tenant.id)
        .send(payload)
        .expect(409);
    });

    it('✅ Handles concurrent CSV uploads atomically', async () => {
      const tenant = await createTenantWithUser('concurrency@test.com', 'ADMIN');

      const externalId = `RACE-${Date.now()}`;
      const csvContent = Buffer.from(
        `external_id,customer_name,amount,status\n${externalId},Race Corp,1000,paid`,
      );

      // Fire 5 concurrent uploads with same external_id
      const uploads = Array(5)
        .fill(0)
        .map(() =>
          request(app!.getHttpServer())
            .post('/connectors/csv-upload')
            .set('Authorization', `Bearer ${tenant.token}`)
            .set('x-tenant-id', tenant.id)
            .attach('file', csvContent, 'race.csv'),
        );

      await Promise.allSettled(uploads);

      // Verify only 1 record created
      const invoicesRes = await request(app!.getHttpServer())
        .get('/invoices')
        .set('Authorization', `Bearer ${tenant.token}`)
        .set('x-tenant-id', tenant.id)
        .expect(200);

      const matches = invoicesRes.body.filter((i: any) => i.external_id === externalId);
      expect(matches.length).toBe(1);
    });
  });

  // =============================================================================
  // 9️⃣ MULTI-TENANT ISOLATION
  // =============================================================================
  describe('Security: Multi-Tenant Data Isolation', () => {
    it('❌ Tenant A cannot access Tenant B data', async () => {
      const tenantA = await createTenantWithUser('tenant-a@test.com', 'ADMIN');
      const tenantB = await createTenantWithUser('tenant-b@test.com', 'ADMIN');

      // Create invoice in Tenant A
      const invoiceRes = await request(app!.getHttpServer())
        .post('/invoices')
        .set('Authorization', `Bearer ${tenantA.token}`)
        .set('x-tenant-id', tenantA.id)
        .send({
          customer_name: 'Secret Client',
          amount: 10000,
          external_id: 'SECRET-INV',
          currency: 'USD',
          status: 'draft',
        })
        .expect(201);

      // Tenant B tries to access it - should get 404
      await request(app!.getHttpServer())
        .get(`/invoices/${invoiceRes.body.id}`)
        .set('Authorization', `Bearer ${tenantB.token}`)
        .set('x-tenant-id', tenantB.id)
        .expect(404);
    });

    it('✅ Dashboard shows only tenant-scoped metrics', async () => {
      const tenantA = await createTenantWithUser('metrics-a@test.com', 'ADMIN');
      const tenantB = await createTenantWithUser('metrics-b@test.com', 'ADMIN');

      // Upload data to both tenants
      const csvA = Buffer.from('external_id,customer_name,amount,status\nA1,Corp A,5000,paid');
      const csvB = Buffer.from('external_id,customer_name,amount,status\nB1,Corp B,3000,paid');

      await request(app!.getHttpServer())
        .post('/connectors/csv-upload')
        .set('Authorization', `Bearer ${tenantA.token}`)
        .set('x-tenant-id', tenantA.id)
        .attach('file', csvA, 'a.csv')
        .expect(201);

      await request(app!.getHttpServer())
        .post('/connectors/csv-upload')
        .set('Authorization', `Bearer ${tenantB.token}`)
        .set('x-tenant-id', tenantB.id)
        .attach('file', csvB, 'b.csv')
        .expect(201);

      // Verify dashboards are isolated
      const dashA = await request(app!.getHttpServer())
        .get('/finance/dashboard')
        .set('Authorization', `Bearer ${tenantA.token}`)
        .set('x-tenant-id', tenantA.id)
        .expect(200);

      const dashB = await request(app!.getHttpServer())
        .get('/finance/dashboard')
        .set('Authorization', `Bearer ${tenantB.token}`)
        .set('x-tenant-id', tenantB.id)
        .expect(200);

      expect(dashA.body.cashFlow.totalCollected).toBe(5000);
      expect(dashB.body.cashFlow.totalCollected).toBe(3000);
    });
  });

  // =============================================================================
  // 🔟 SECURITY: Encryption & Auth Boundaries
  // =============================================================================
  describe('Security: Encryption & Auth Boundaries', () => {
    it('🛡️ Encrypts sensitive data in database', async () => {
      const tenant = await createTenantWithUser('encryption@test.com', 'ADMIN');

      const csvContent = Buffer.from(
        'external_id,customer_name,amount,status\n' + 'ENC-001,Sensitive Client,50000,paid',
      );

      await request(app!.getHttpServer())
        .post('/connectors/csv-upload')
        .set('Authorization', `Bearer ${tenant.token}`)
        .set('x-tenant-id', tenant.id)
        .attach('file', csvContent, 'encrypted.csv')
        .expect(201);

      // Verify raw DB value is encrypted
      await runWithTenantContext(
        { tenantId: tenant.id, userId: 'DB_VERIFIER', schemaName: tenant.schemaName },
        async () => {
          const runner = await db.getRunner();
          try {
            const rawRows = await runner.query(
              `SELECT customer_name FROM "${tenant.schemaName}"."invoices" WHERE external_id=$1`,
              ['ENC-001'],
            );
            const rawValue = rawRows[0].customer_name;

            // Encrypted format: nonce:authTag:ciphertext
            expect(rawValue).toContain(':');
            expect(rawValue).not.toBe('Sensitive Client');
            console.log('✅ Raw encrypted value:', rawValue);
          } finally {
            await runner.release();
          }
        },
      );
    });

    it('❌ Blocks JWT missing tenantId claim', async () => {
      // Create a user without tenant (lobby mode)
      const registerRes = await request(app!.getHttpServer())
        .post('/auth/register')
        .send({
          email: `no-tenant-${Date.now()}@test.com`,
          password: 'Password123!',
          fullName: 'No Tenant User',
          role: 'ADMIN',
        })
        .expect(201);

      const loginRes = await request(app!.getHttpServer())
        .post('/auth/login')
        .send({ email: `no-tenant-${Date.now()}@test.com`, password: 'Password123!' })
        .expect(200);

      const lobbyToken = loginRes.body.access_token;

      await request(app!.getHttpServer())
        .get('/invoices')
        .set('Authorization', `Bearer ${lobbyToken}`)
        .expect(403);
    });

    it('❌ Blocks access to non-existent tenant', async () => {
      // Create a user without tenant (lobby mode)
      const registerRes = await request(app!.getHttpServer())
        .post('/auth/register')
        .send({
          email: `fake-tenant-${Date.now()}@test.com`,
          password: 'Password123!',
          fullName: 'Fake Tenant User',
          role: 'ADMIN',
        })
        .expect(201);

      const loginRes = await request(app!.getHttpServer())
        .post('/auth/login')
        .send({ email: `fake-tenant-${Date.now()}@test.com`, password: 'Password123!' })
        .expect(200);

      const lobbyToken = loginRes.body.access_token;

      await request(app!.getHttpServer())
        .get('/invoices')
        .set('Authorization', `Bearer ${lobbyToken}`)
        .set('x-tenant-id', 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')
        .expect(401);
    });
  });
});
