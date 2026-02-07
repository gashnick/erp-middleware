import { INestApplication } from '@nestjs/common';
import { setupTestApp, teardownTestApp, resetDatabase } from '../../setup/test-app.bootstrap';
import { publicRequest, authenticatedRequest, pollUntil } from '../../setup/test-helpers';
import {
  userFactory,
  organizationFactory,
  connectorFactory,
  financialRecordFactory,
} from '../../setup/test-data-factories';

describe('End-to-End User Journey', () => {
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

  it('should complete full tenant signup to dashboard flow within 60 seconds', async () => {
    const startTime = Date.now();

    // Step 1: User registration
    const userData = userFactory.validRegistration();
    await publicRequest(app).post('/auth/register').send(userData).expect(201);

    // Step 2: User login
    const loginResponse = await publicRequest(app)
      .post('/auth/login')
      .send({ email: userData.email, password: userData.password })
      .expect(200);

    const token = loginResponse.body.access_token;

    // Step 3: Create organization (tenant provisioning)
    const orgData = organizationFactory.validOrganization();
    const orgResponse = await authenticatedRequest(app, token)
      .post('/tenants/organizations')
      .send(orgData)
      .expect(201);

    expect(orgResponse.body).toMatchObject({
      tenantId: expect.any(String),
      schemaName: expect.any(String),
    });

    // Step 4: Upload CSV data
    const invoiceRecords = Array.from({ length: 50 }, () => financialRecordFactory.invoice());

    const uploadResponse = await authenticatedRequest(app, token)
      .post('/etl/ingest')
      .send({
        source: 'csv_upload',
        entityType: 'invoice',
        records: invoiceRecords,
      })
      .expect(202);

    // Step 5: Wait for ETL to complete
    await pollUntil(
      async () => {
        const statusResponse = await authenticatedRequest(app, token)
          .get(`/etl/jobs/${uploadResponse.body.jobId}`)
          .expect(200);

        return statusResponse.body.status === 'completed';
      },
      60,
      500,
    ); // 30 second timeout, check every 500ms

    // Step 6: View finance dashboard
    const dashboardResponse = await authenticatedRequest(app, token)
      .get('/dashboard/finance')
      .expect(200);

    expect(dashboardResponse.body).toMatchObject({
      cashFlow: expect.any(Object),
      arAging: expect.any(Object),
      apAging: expect.any(Object),
      profitability: expect.any(Object),
      anomalies: expect.any(Array),
    });

    const endTime = Date.now();
    const totalTime = (endTime - startTime) / 1000;

    console.log(`✓ Complete flow took ${totalTime}s`);
    expect(totalTime).toBeLessThan(60); // Must complete within 60 seconds
  });

  it('should handle connector health check and retry flow', async () => {
    const userData = userFactory.validRegistration();
    await publicRequest(app).post('/auth/register').send(userData);

    const loginResponse = await publicRequest(app)
      .post('/auth/login')
      .send({ email: userData.email, password: userData.password });

    const token = loginResponse.body.access_token;

    const orgData = organizationFactory.validOrganization();
    await authenticatedRequest(app, token).post('/tenants/organizations').send(orgData);

    // Create QuickBooks connector
    const connectorData = connectorFactory.quickbooks();
    const connectorResponse = await authenticatedRequest(app, token)
      .post('/connectors')
      .send(connectorData)
      .expect(201);

    const connectorId = connectorResponse.body.id;

    // Check connector health
    const healthResponse = await authenticatedRequest(app, token)
      .get(`/connectors/${connectorId}/health`)
      .expect(200);

    expect(healthResponse.body).toMatchObject({
      status: expect.stringMatching(/^(healthy|degraded|unhealthy)$/),
      lastSync: expect.any(String),
      nextSync: expect.any(String),
      errorCount: expect.any(Number),
    });

    // Trigger manual sync
    await authenticatedRequest(app, token).post(`/connectors/${connectorId}/sync`).expect(202);
  });
});
