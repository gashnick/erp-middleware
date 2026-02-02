// test/concurrency-safety.e2e-spec.ts
import * as request from 'supertest';
import {
  setupTestApp,
  teardownTestApp,
  app,
  resetDatabase,
  createTenantWithUser,
} from './test-app.bootstrap';

describe('Concurrency & ETL Idempotency (Production Security)', () => {
  beforeAll(async () => await setupTestApp());
  beforeEach(async () => await resetDatabase());
  afterAll(async () => await teardownTestApp());

  it('✅ 1. Atomic Upsert (Race Condition)', async () => {
    // Create tenant and admin user
    const admin = await createTenantWithUser('race@test.com');

    // Use token directly (no promotion needed)
    const token = admin.token;

    const externalId = `EXT-${Date.now()}`;
    const payload = {
      external_id: externalId,
      amount: 250,
      customer_name: 'Race Condition Corp',
    };

    // Fire 5 concurrent requests
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

    // Verify only one record exists
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

    // First request succeeds
    await request(app!.getHttpServer())
      .post('/invoices')
      .set('Authorization', `Bearer ${token}`)
      .set('x-tenant-id', admin.id)
      .send(payload)
      .expect(201);

    // Second request fails with 409 Conflict
    await request(app!.getHttpServer())
      .post('/invoices')
      .set('Authorization', `Bearer ${token}`)
      .set('x-tenant-id', admin.id)
      .send(payload)
      .expect(409);
  });
});
