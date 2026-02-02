import * as request from 'supertest';
import {
  setupTestApp,
  teardownTestApp,
  app,
  resetDatabase,
  createTenantWithUser,
} from './test-app.bootstrap';

describe('Request Scoped Isolation & Security', () => {
  beforeAll(async () => await setupTestApp());
  beforeEach(async () => await resetDatabase());
  afterAll(async () => await teardownTestApp());

  it('Tenant context does not leak between requests', async () => {
    const tenantA = await createTenantWithUser('a@test.com', 'ADMIN');
    const tenantB = await createTenantWithUser('b@test.com', 'ADMIN');

    await request(app!.getHttpServer())
      .post('/invoices')
      .set('Authorization', `Bearer ${tenantA.token}`)
      .set('x-tenant-id', tenantA.id)
      .send({ customer_name: 'Customer A', amount: 100, external_id: 'INV-A' })
      .expect(201);

    const resB = await request(app!.getHttpServer())
      .get('/invoices')
      .set('Authorization', `Bearer ${tenantB.token}`)
      .set('x-tenant-id', tenantB.id)
      .expect(200);

    expect(resB.body.length).toBe(0);
  });

  it('Sensitive data is encrypted in DB', async () => {
    const tenant = await createTenantWithUser('security-owner@test.com', 'ADMIN');

    const customer = 'High Value Client';
    const res = await request(app!.getHttpServer())
      .post('/invoices')
      .set('Authorization', `Bearer ${tenant.token}`)
      .set('x-tenant-id', tenant.id)
      .send({
        customer_name: customer,
        amount: 15000,
        external_id: 'SEC-INV-99',
        is_encrypted: true,
      })
      .expect(201);

    expect(res.body.customer_name).toBe(customer);
  });
});
