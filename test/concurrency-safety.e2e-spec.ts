import * as request from 'supertest';
import {
  setupTestApp,
  teardownTestApp,
  app,
  resetDatabase,
  createTenantWithUser,
} from './test-app.bootstrap';

describe('Concurrency & ETL Idempotency', () => {
  beforeAll(async () => await setupTestApp());
  beforeEach(async () => await resetDatabase());
  afterAll(async () => await teardownTestApp());

  it('✅ 1. Atomic Upsert (Race Condition)', async () => {
    const admin = await createTenantWithUser('race@test.com');
    const token = admin.token;

    const externalId = `EXT-${Date.now()}`;
    const payload = {
      external_id: externalId,
      amount: 250,
      customer_name: 'Race Condition Corp',
    };

    const requests = Array(5)
      .fill(0)
      .map(() =>
        request(app!.getHttpServer())
          .post('/invoices')
          .set('Authorization', `Bearer ${token}`)
          .set('x-tenant-id', admin.id)
          .send(payload),
      );

    await Promise.allSettled(requests);

    const res = await request(app!.getHttpServer())
      .get('/invoices')
      .set('Authorization', `Bearer ${token}`)
      .set('x-tenant-id', admin.id)
      .expect(200);

    const matches = res.body.filter((inv: any) => inv.external_id === externalId);
    expect(matches.length).toBe(1);
  });

  it('❌ 2. Idempotency Enforced (Duplicate external_id)', async () => {
    const admin = await createTenantWithUser('idemp@test.com');
    const token = admin.token;

    const payload = {
      amount: 100,
      customer_name: 'Idemp Corp',
      external_id: 'unique-sync-123',
    };

    await request(app!.getHttpServer())
      .post('/invoices')
      .set('Authorization', `Bearer ${token}`)
      .set('x-tenant-id', admin.id)
      .send(payload)
      .expect(201);

    await request(app!.getHttpServer())
      .post('/invoices')
      .set('Authorization', `Bearer ${token}`)
      .set('x-tenant-id', admin.id)
      .send(payload)
      .expect(409);
  });
});
