import { INestApplication } from '@nestjs/common';
import { setupTestApp, teardownTestApp, resetDatabase } from '../../../setup/test-app.bootstrap';
import { publicRequest, authenticatedRequest, pollUntil } from '../../../setup/test-helpers';
import {
  userFactory,
  organizationFactory,
  financialRecordFactory,
} from '../../../setup/test-data-factories';

describe('Finance Dashboard', () => {
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

  it('shows finance dashboard metrics after ETL ingest from tenant-specific schema', async () => {
    const user = userFactory.validRegistration();
    await publicRequest(app).post('/auth/register').send(user);

    let login = await publicRequest(app)
      .post('/auth/login')
      .send({ email: user.email, password: user.password });
    let token = login.body.access_token;

    const orgResp = await authenticatedRequest(app, token)
      .post('/tenants/organizations')
      .send(organizationFactory.validOrganization())
      .expect(201);

    const tenantId = orgResp.body.tenantId;

    // 🔑 RE-LOGIN to get a token with tenantId populated
    login = await publicRequest(app)
      .post('/auth/login')
      .send({ email: user.email, password: user.password });
    token = login.body.access_token; // Fresh token with tenantId

    // Now ingest and query with the proper token
    const records = Array.from({ length: 5 }, () => financialRecordFactory.invoice());
    const resp = await authenticatedRequest(app, token)
      .post('/etl/ingest')
      .send({ source: 'csv_upload', entityType: 'invoice', records })
      .expect(202);

    await pollUntil(
      async () => {
        const status = await authenticatedRequest(app, token).get(`/etl/jobs/${resp.body.jobId}`);
        return status.body.status === 'completed';
      },
      30,
      500,
    );

    const dash = await authenticatedRequest(app, token).get('/dashboard/finance').expect(200);

    expect(dash.body).toMatchObject({
      cashFlow: expect.any(Object),
      arAging: expect.any(Object),
      tenantId: tenantId,
    });
  });
});
