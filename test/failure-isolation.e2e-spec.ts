import * as request from 'supertest';
import {
  setupTestApp,
  teardownTestApp,
  app,
  resetDatabase,
  createTenantWithUser,
} from './test-app.bootstrap';

describe('Failure Mode Isolation', () => {
  beforeAll(async () => await setupTestApp());
  beforeEach(async () => await resetDatabase());
  afterAll(async () => await teardownTestApp());

  it('✅ Poison Pill Isolation', async () => {
    const tenantA = await createTenantWithUser('tenantA@test.com', 'ADMIN');
    const tenantB = await createTenantWithUser('tenantB@test.com', 'ADMIN');

    // Malformed payload for Tenant A
    await request(app!.getHttpServer())
      .post('/connectors/sync')
      .set('Authorization', `Bearer ${tenantA.token}`)
      .set('x-tenant-id', tenantA.id)
      .send({ malformed_garbage: true })
      .expect(500);

    // Tenant B remains unaffected
    await request(app!.getHttpServer()).get('/health').expect(200);

    await request(app!.getHttpServer())
      .get('/invoices')
      .set('Authorization', `Bearer ${tenantB.token}`)
      .set('x-tenant-id', tenantB.id)
      .expect(200);
  });
});
