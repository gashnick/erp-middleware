import { INestApplication } from '@nestjs/common';
import { setupTestApp, teardownTestApp, resetDatabase } from '../../../setup/test-app.bootstrap';
import {
  connectorFactory,
  organizationFactory,
  userFactory,
} from '../../../setup/test-data-factories';
import { authenticatedRequest, publicRequest } from '../../../setup/test-helpers';

describe('QuickBooks Connector', () => {
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

  it('creates a QuickBooks connector and checks health and sync', async () => {
    const user = userFactory.validRegistration();
    await publicRequest(app).post('/auth/register').send(user);
    const login = await publicRequest(app)
      .post('/auth/login')
      .send({ email: user.email, password: user.password });
    const token = login.body.access_token;
    await authenticatedRequest(app, token)
      .post('/tenants/organizations')
      .send(organizationFactory.validOrganization());

    const connectorData = connectorFactory.quickbooks();
    const created = await authenticatedRequest(app, token)
      .post('/connectors')
      .send(connectorData)
      .expect(201);
    expect(created.body).toHaveProperty('id');

    const health = await authenticatedRequest(app, token)
      .get(`/connectors/${created.body.id}/health`)
      .expect(200);
    expect(health.body).toHaveProperty('status');

    // Trigger sync and expect accepted
    const syncResp = await authenticatedRequest(app, token)
      .post(`/connectors/${created.body.id}/sync`)
      .expect(200);
    // Controller returns accepted flag in tests
    expect(syncResp.body).toHaveProperty('accepted');
  });
});
