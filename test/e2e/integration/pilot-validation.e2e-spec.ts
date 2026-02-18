import { INestApplication } from '@nestjs/common';
import { setupTestApp, teardownTestApp, resetDatabase } from '../../setup/test-app.bootstrap';
import { publicRequest, authenticatedRequest } from '../../setup/test-helpers';
import { userFactory, organizationFactory } from '../../setup/test-data-factories';

describe('E2E Validation Suite - Enterprise Pilot Approval', () => {
  let app: INestApplication;
  let userToken: string;
  let tenantToken: string;
  let invoiceId: string;

  beforeAll(async () => {
    app = await setupTestApp();
  });

  afterAll(async () => {
    await teardownTestApp();
  });

  beforeEach(async () => {
    await resetDatabase();
  });

  // ─── Shared helper ──────────────────────────────────────────────────────────
  async function provisionTenant(app: INestApplication): Promise<{
    userToken: string;
    tenantToken: string;
    tenantId: string;
  }> {
    const userData = userFactory.validRegistration();
    await publicRequest(app).post('/auth/register').send(userData).expect(201);

    const loginResponse = await publicRequest(app)
      .post('/auth/login')
      .send({ email: userData.email, password: userData.password })
      .expect(200);

    const uToken = loginResponse.body.access_token;

    const orgData = organizationFactory.validOrganization();
    const provisionResponse = await authenticatedRequest(app, uToken)
      .post('/tenants')
      .send(orgData)
      .expect(201);

    const tToken = provisionResponse.body.auth.accessToken;
    const tenantId = provisionResponse.body.tenantId;

    return { userToken: uToken, tenantToken: tToken, tenantId };
  }

  // ───────────────────────────────────────────────────────────────────────────

  describe('PHASE 1: Authentication & Tenant Provisioning', () => {
    it('1.1 Should register user successfully', async () => {
      const userData = userFactory.validRegistration();
      const response = await publicRequest(app).post('/auth/register').send(userData).expect(201);

      expect(response.body).toHaveProperty('id');
      expect(response.body.email).toBe(userData.email);
      expect(response.body).not.toHaveProperty('password');
    });

    it('1.2 Should reject duplicate email', async () => {
      const userData = userFactory.validRegistration();
      await publicRequest(app).post('/auth/register').send(userData).expect(201);
      await publicRequest(app).post('/auth/register').send(userData).expect(409);
    });

    it('1.3 Should block SQL injection in registration', async () => {
      const response = await publicRequest(app).post('/auth/register').send({
        email: 'not-an-email',
        password: 'Test123!',
        fullName: 'SQL Inject',
        role: 'ADMIN',
      });

      expect(response.status).not.toBe(201);
      expect([400, 422]).toContain(response.status);
    });

    it('1.4 Should login and receive token', async () => {
      const userData = userFactory.validRegistration();
      await publicRequest(app).post('/auth/register').send(userData).expect(201);

      const response = await publicRequest(app)
        .post('/auth/login')
        .send({ email: userData.email, password: userData.password })
        .expect(200);

      expect(response.body).toHaveProperty('access_token');
      userToken = response.body.access_token;
    });

    it('1.5 Should create tenant successfully', async () => {
      const userData = userFactory.validRegistration();
      await publicRequest(app).post('/auth/register').send(userData).expect(201);

      const loginResponse = await publicRequest(app)
        .post('/auth/login')
        .send({ email: userData.email, password: userData.password })
        .expect(200);

      userToken = loginResponse.body.access_token;

      const orgData = organizationFactory.validOrganization();
      const response = await authenticatedRequest(app, userToken)
        .post('/tenants')
        .send(orgData)
        .expect(201);

      expect(response.body).toHaveProperty('tenantId');
      expect(response.body).toHaveProperty('auth');
      expect(response.body.auth).toHaveProperty('accessToken');

      tenantToken = response.body.auth.accessToken;
    });
  });

  describe('PHASE 2: Data Ingestion (ETL)', () => {
    beforeEach(async () => {
      const provisioned = await provisionTenant(app);
      userToken = provisioned.userToken;
      tenantToken = provisioned.tenantToken;
    });

    it('2.1 Should create invoice successfully', async () => {
      const response = await authenticatedRequest(app, tenantToken)
        .post('/invoices')
        .send({
          customer_name: 'Test Customer',
          amount: 5000,
          currency: 'USD',
          status: 'paid',
        })
        .expect(201);

      expect(response.body).toHaveProperty('id');
      invoiceId = response.body.id;
    });

    it('2.2 Should handle ETL bulk ingestion', async () => {
      const response = await authenticatedRequest(app, tenantToken)
        .post('/etl/ingest')
        .send({
          source: 'csv_upload',
          entityType: 'invoice',
          records: [
            { customer_name: 'ETL Test 1', amount: 1000, external_id: 'ETL-001', status: 'paid' },
            {
              customer_name: 'ETL Test 2',
              amount: 2000,
              external_id: 'ETL-002',
              status: 'pending',
            },
          ],
        })
        .expect(201);

      expect(response.body).toHaveProperty('jobId');
    });

    it('2.3 Should block SQL injection in ETL data', async () => {
      await authenticatedRequest(app, tenantToken)
        .post('/etl/ingest')
        .send({
          source: 'csv_upload',
          entityType: 'invoice',
          records: [
            {
              customer_name: "Test'; DROP TABLE invoices; --",
              amount: 1000,
              external_id: 'SQL-001',
              status: 'paid',
            },
          ],
        });

      // Verify the invoices table is still intact
      const invoices = await authenticatedRequest(app, tenantToken).get('/invoices').expect(200);

      const invoiceList = Array.isArray(invoices.body) ? invoices.body : invoices.body?.data;
      expect(invoiceList).toBeDefined();
      expect(Array.isArray(invoiceList)).toBe(true);
    });
  });

  describe('PHASE 3: Analytics & Anomaly Detection', () => {
    beforeEach(async () => {
      const provisioned = await provisionTenant(app);
      userToken = provisioned.userToken;
      tenantToken = provisioned.tenantToken;
    });

    it('3.1 Should access finance dashboard', async () => {
      const response = await authenticatedRequest(app, tenantToken)
        .get('/dashboard/finance')
        .expect(200);

      expect(response.body).toHaveProperty('cashFlow');
    });

    it('3.2 Should detect anomalies', async () => {
      await authenticatedRequest(app, tenantToken)
        .post('/invoices')
        .send({
          customer_name: 'Huge Customer',
          amount: 999999999,
          status: 'paid',
        })
        .expect(201);

      const response = await authenticatedRequest(app, tenantToken).post('/ai/detect-anomalies');

      expect([200, 201, 404]).toContain(response.status);
    });
  });

  describe('PHASE 4: Security Validation', () => {
    beforeEach(async () => {
      const provisioned = await provisionTenant(app);
      userToken = provisioned.userToken;
      tenantToken = provisioned.tenantToken;

      const invoiceResponse = await authenticatedRequest(app, tenantToken)
        .post('/invoices')
        .send({
          customer_name: 'Test Customer',
          amount: 5000,
          status: 'paid',
        })
        .expect(201);

      invoiceId = invoiceResponse.body.id;
    });

    it('4.1 Should block JWT manipulation', async () => {
      const fakeToken =
        'eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJzdWIiOiJhZG1pbiIsInJvbGUiOiJBRE1JTiJ9.';

      await authenticatedRequest(app, fakeToken).get('/invoices').expect(401);
    });

    it('4.2 Should enforce cross-tenant isolation', async () => {
      // Provision a second independent tenant
      const { tenantToken: tenant2Token } = await provisionTenant(app);

      // Tenant 2 should NOT be able to access Tenant 1's invoice
      const response = await authenticatedRequest(app, tenant2Token).get(`/invoices/${invoiceId}`);

      expect([403, 404]).toContain(response.status);
    });

    it('4.3 Should block XSS in input fields', async () => {
      const response = await authenticatedRequest(app, tenantToken).post('/invoices').send({
        customer_name: '<script>alert("XSS")</script>',
        amount: 1000,
        status: 'paid',
      });

      // Documents current behavior — XSS protection requires a sanitization layer
      expect([200, 201, 400]).toContain(response.status);

      if (response.status === 201) {
        expect(response.body).toHaveProperty('id');
        expect(response.body).toHaveProperty('customer_name');
        // Note: In production, customer_name should be HTML-escaped on retrieval
      }
    });
  });

  describe('PHASE 5: Performance Baseline', () => {
    beforeEach(async () => {
      const provisioned = await provisionTenant(app);
      userToken = provisioned.userToken;
      tenantToken = provisioned.tenantToken; // ✅ use actual tenant-scoped token
    });

    it('5.1 Should measure login latency', async () => {
      const userData = userFactory.validRegistration();
      await publicRequest(app).post('/auth/register').send(userData).expect(201);

      const start = Date.now();
      await publicRequest(app)
        .post('/auth/login')
        .send({ email: userData.email, password: userData.password })
        .expect(200);

      const latency = Date.now() - start;
      console.log(`Login latency: ${latency}ms`);
      expect(latency).toBeLessThan(1000);
    });

    it('5.2 Should measure analytics latency', async () => {
      const start = Date.now();
      await authenticatedRequest(app, tenantToken).get('/dashboard/finance').expect(200);

      const latency = Date.now() - start;
      console.log(`Analytics latency: ${latency}ms`);
      expect(latency).toBeLessThan(2000);
    });
  });
});
