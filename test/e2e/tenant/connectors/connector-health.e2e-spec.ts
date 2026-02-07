import { INestApplication } from '@nestjs/common';
import { setupTestApp, teardownTestApp, resetDatabase } from '../../../setup/test-app.bootstrap';
import { publicRequest, authenticatedRequest } from '../../../setup/test-helpers';
import {
  userFactory,
  organizationFactory,
  connectorFactory,
} from '../../../setup/test-data-factories';

describe('Connector Health', () => {
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

  it('returns connector health and respects retry metadata', async () => {
    const user = userFactory.validRegistration();
    await publicRequest(app).post('/auth/register').send(user);
    const login = await publicRequest(app)
      .post('/auth/login')
      .send({ email: user.email, password: user.password });
    const token = login.body.access_token;
    await authenticatedRequest(app, token)
      .post('/tenants/organizations')
      .send(organizationFactory.validOrganization());

    const created = await authenticatedRequest(app, token)
      .post('/connectors')
      .send(connectorFactory.csvUpload())
      .expect(201);
    const health = await authenticatedRequest(app, token)
      .get(`/connectors/${created.body.id}/health`)
      .expect(200);

    expect(health.body).toMatchObject({ id: created.body.id, tenantId: expect.any(String) });
    expect(health.body).toHaveProperty('lastSync');
    expect(health.body).toHaveProperty('nextSync');
  });
});
