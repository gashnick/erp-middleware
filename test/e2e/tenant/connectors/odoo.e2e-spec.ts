import { INestApplication } from '@nestjs/common';
import { setupTestApp, teardownTestApp, resetDatabase } from '../../../setup/test-app.bootstrap';
import { publicRequest, authenticatedRequest } from '../../../setup/test-helpers';
import { userFactory, organizationFactory } from '../../../setup/test-data-factories';

describe('Odoo Connector', () => {
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

  it('creates an Odoo connector and checks health endpoint', async () => {
    const user = userFactory.validRegistration();
    await publicRequest(app).post('/auth/register').send(user);
    const login = await publicRequest(app)
      .post('/auth/login')
      .send({ email: user.email, password: user.password });
    const token = login.body.access_token;
    await authenticatedRequest(app, token)
      .post('/tenants/organizations')
      .send(organizationFactory.validOrganization());

    const connectorData = { type: 'odoo', name: 'Odoo Test' };
    const created = await authenticatedRequest(app, token)
      .post('/connectors')
      .send(connectorData)
      .expect(201);
    expect(created.body).toHaveProperty('id');

    const health = await authenticatedRequest(app, token)
      .get(`/connectors/${created.body.id}/health`)
      .expect(200);
    expect(health.body).toHaveProperty('tenantId');
  });
});
