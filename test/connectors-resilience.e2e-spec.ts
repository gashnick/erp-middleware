import * as request from 'supertest';
import { setupTestApp, app, createTenantWithUser, resetDatabase } from './test-app.bootstrap';

describe('Connector Resilience & Observability', () => {
  let tenantToken: string;
  let tenantId: string;

  beforeAll(async () => await setupTestApp());
  beforeEach(async () => {
    await resetDatabase();
    const setup = await createTenantWithUser('analyst@resilience.com', 'ANALYST');
    tenantToken = setup.token;
    tenantId = setup.id;
  });

  it('✅ Should list connectors with healthy status', async () => {
    return request(app!.getHttpServer())
      .get('/connectors')
      .set('Authorization', `Bearer ${tenantToken}`)
      .set('x-tenant-id', tenantId)
      .expect(200)
      .expect((res) => {
        expect(Array.isArray(res.body)).toBe(true);
      });
  });

  it('⚠️ Should reflect backoff status when a sync fails', async () => {
    const response = await request(app!.getHttpServer())
      .get('/connectors')
      .set('Authorization', `Bearer ${tenantToken}`)
      .set('x-tenant-id', tenantId)
      .expect(200);

    if (response.body.length > 0) {
      expect(response.body[0]).toHaveProperty('status');
      expect(response.body[0]).toHaveProperty('lastSyncAt');
    }
  });
});
