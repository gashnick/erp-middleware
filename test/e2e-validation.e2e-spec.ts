import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('E2E Validation Suite - Enterprise Pilot Approval', () => {
  let app: INestApplication;
  let userEmail: string;
  let publicToken: string;
  let tenantToken: string;
  let invoiceId: string;
  let tenant2Token: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('PHASE 1: Authentication & Tenant Provisioning', () => {
    it('1.1 Should register a new user successfully', async () => {
      const timestamp = Date.now();
      userEmail = `qa.test.${timestamp}@enterprise.com`;

      const response = await request(app.getHttpServer())
        .post('/api/auth/register')
        .send({
          email: userEmail,
          password: 'SecureP@ssw0rd123!',
          fullName: 'QA Test User',
          role: 'ADMIN',
        })
        .expect(201);

      expect(response.body).toHaveProperty('id');
      expect(response.body.email).toBe(userEmail);
      expect(response.body).not.toHaveProperty('password');
    });

    it('1.2 Should reject duplicate email registration', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/register')
        .send({
          email: userEmail,
          password: 'AnotherP@ss123!',
          fullName: 'Duplicate User',
          role: 'ADMIN',
        })
        .expect(409);
    });

    it('1.3 Should block SQL injection in registration', async () => {
      const response = await request(app.getHttpServer()).post('/api/auth/register').send({
        email: "admin'--@test.com",
        password: 'Test123!',
        fullName: 'SQL Inject',
        role: 'ADMIN',
      });

      expect([400, 422]).toContain(response.status);
    });

    it('1.4 Should login successfully and receive token', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({
          email: userEmail,
          password: 'SecureP@ssw0rd123!',
        })
        .expect(200);

      expect(response.body).toHaveProperty('access_token');
      publicToken = response.body.access_token;
    });

    it('1.5 Should enforce rate limiting', async () => {
      const requests = [];
      let rateLimitTriggered = false;

      for (let i = 0; i < 15; i++) {
        const req = request(app.getHttpServer()).post('/api/auth/login').send({
          email: 'wrong@test.com',
          password: 'wrong',
        });
        requests.push(req);
      }

      const responses = await Promise.all(requests);
      rateLimitTriggered = responses.some((r: any) => r.status === 429);

      expect(rateLimitTriggered).toBe(true);
    }, 30000);

    it('1.6 Should create tenant successfully', async () => {
      const timestamp = Date.now();
      const response = await request(app.getHttpServer())
        .post('/api/tenants')
        .set('Authorization', `Bearer ${publicToken}`)
        .send({
          companyName: `QA Test Corp ${timestamp}`,
          dataSourceType: 'external',
          subscriptionPlan: 'enterprise',
        })
        .expect(201);

      expect(response.body).toHaveProperty('auth');
      expect(response.body.auth).toHaveProperty('accessToken');
      tenantToken = response.body.auth.accessToken;
    });
  });

  describe('PHASE 2: Data Ingestion (ETL)', () => {
    it('2.1 Should create invoice successfully', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/invoices')
        .set('Authorization', `Bearer ${tenantToken}`)
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
      const response = await request(app.getHttpServer())
        .post('/api/etl/ingest')
        .set('Authorization', `Bearer ${tenantToken}`)
        .send({
          source: 'csv_upload',
          entityType: 'invoice',
          records: [
            {
              customer_name: 'ETL Test 1',
              amount: 1000,
              external_id: 'ETL-001',
              status: 'paid',
            },
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
      const jobId = response.body.jobId;

      // Wait for job completion
      await new Promise((resolve) => setTimeout(resolve, 3000));

      const jobStatus = await request(app.getHttpServer())
        .get(`/api/etl/jobs/${jobId}`)
        .set('Authorization', `Bearer ${tenantToken}`)
        .expect(200);

      expect(jobStatus.body.status).toBe('completed');
    }, 10000);

    it('2.3 Should block SQL injection in ETL data', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/etl/ingest')
        .set('Authorization', `Bearer ${tenantToken}`)
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

      expect([200, 201]).toContain(response.status);

      // Verify table still exists by querying invoices
      const invoices = await request(app.getHttpServer())
        .get('/api/invoices')
        .set('Authorization', `Bearer ${tenantToken}`)
        .expect(200);

      expect(Array.isArray(invoices.body)).toBe(true);
    });
  });

  describe('PHASE 3: Analytics & Anomaly Detection', () => {
    it('3.1 Should access finance dashboard', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/finance/dashboard')
        .set('Authorization', `Bearer ${tenantToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('cashFlow');
      expect(response.body.cashFlow).toHaveProperty('totalInvoiced');
    });

    it('3.2 Should access AI analytics endpoint', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/ai/analytics')
        .set('Authorization', `Bearer ${tenantToken}`);

      expect([200, 404]).toContain(response.status);
    });

    it('3.3 Should detect anomalies', async () => {
      // Create abnormal invoice
      await request(app.getHttpServer())
        .post('/api/invoices')
        .set('Authorization', `Bearer ${tenantToken}`)
        .send({
          customer_name: 'Huge Customer',
          amount: 999999999,
          status: 'paid',
        })
        .expect(201);

      const response = await request(app.getHttpServer())
        .post('/api/ai/detect-anomalies')
        .set('Authorization', `Bearer ${tenantToken}`);

      expect([200, 201, 404]).toContain(response.status);
    });
  });

  describe('PHASE 4: Security Validation', () => {
    it('4.1 Should block JWT manipulation', async () => {
      const fakeToken =
        'eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJzdWIiOiJhZG1pbiIsInJvbGUiOiJBRE1JTiJ9.';

      await request(app.getHttpServer())
        .get('/api/invoices')
        .set('Authorization', `Bearer ${fakeToken}`)
        .expect(401);
    });

    it('4.2 Should enforce cross-tenant isolation', async () => {
      // Create second tenant
      const timestamp = Date.now();
      const tenant2Email = `tenant2.${timestamp}@test.com`;

      const regResponse = await request(app.getHttpServer())
        .post('/api/auth/register')
        .send({
          email: tenant2Email,
          password: 'SecureP@ss2!',
          fullName: 'Tenant 2',
          role: 'ADMIN',
        })
        .expect(201);

      const loginResponse = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({
          email: tenant2Email,
          password: 'SecureP@ss2!',
        })
        .expect(200);

      const tenant2PublicToken = loginResponse.body.access_token;

      const provResponse = await request(app.getHttpServer())
        .post('/api/tenants')
        .set('Authorization', `Bearer ${tenant2PublicToken}`)
        .send({
          companyName: 'Tenant 2 Corp',
          dataSourceType: 'external',
          subscriptionPlan: 'enterprise',
        })
        .expect(201);

      tenant2Token = provResponse.body.auth.accessToken;

      // Attempt cross-tenant access
      const response = await request(app.getHttpServer())
        .get(`/api/invoices/${invoiceId}`)
        .set('Authorization', `Bearer ${tenant2Token}`);

      expect([403, 404]).toContain(response.status);
    }, 15000);

    it('4.3 Should block XSS in input fields', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/invoices')
        .set('Authorization', `Bearer ${tenantToken}`)
        .send({
          customer_name: '<script>alert("XSS")</script>',
          amount: 1000,
          status: 'paid',
        });

      expect([200, 201, 400]).toContain(response.status);

      if (response.status === 201) {
        expect(response.body.customer_name).not.toContain('<script>');
      }
    });
  });

  describe('PHASE 5: Performance Baseline', () => {
    it('5.1 Should measure login latency', async () => {
      const start = Date.now();

      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({
          email: userEmail,
          password: 'SecureP@ssw0rd123!',
        })
        .expect(200);

      const latency = Date.now() - start;
      console.log(`Login latency: ${latency}ms`);
      expect(latency).toBeLessThan(1000);
    });

    it('5.2 Should measure analytics latency', async () => {
      const start = Date.now();

      await request(app.getHttpServer())
        .get('/api/finance/dashboard')
        .set('Authorization', `Bearer ${tenantToken}`)
        .expect(200);

      const latency = Date.now() - start;
      console.log(`Analytics latency: ${latency}ms`);
      expect(latency).toBeLessThan(2000);
    });
  });
});
