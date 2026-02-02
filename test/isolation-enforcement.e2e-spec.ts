import * as request from 'supertest';
import {
  setupTestApp,
  teardownTestApp,
  app,
  resetDatabase,
  createTenantWithUser,
} from './test-app.bootstrap';

describe('Database & Request Isolation', () => {
  let tenantA: any;
  let tenantB: any;

  beforeAll(async () => await setupTestApp());
  beforeEach(async () => {
    await resetDatabase();
    tenantA = await createTenantWithUser('tenantA@test.com', 'ADMIN');
    tenantB = await createTenantWithUser('tenantB@test.com', 'ADMIN');
  });
  afterAll(async () => await teardownTestApp());

  const createInvoice = async (
    tenant: any,
    payload: any = { customer_name: 'Customer', amount: 100 },
  ) => {
    const res = await request(app!.getHttpServer())
      .post('/invoices')
      .set('Authorization', `Bearer ${tenant.token}`)
      .set('x-tenant-id', tenant.id)
      .send(payload);

    if (res.status !== 201) throw new Error(`Failed to create invoice: ${res.status}`);
    return res.body;
  };

  it('❌ Direct Object Reference (ID Guessing) blocked', async () => {
    const invoiceA = await createInvoice(tenantA);

    expect(invoiceA).toBeDefined();
    expect(typeof invoiceA.id).toBe('string');

    await request(app!.getHttpServer())
      .get(`/invoices/${invoiceA.id}`)
      .set('Authorization', `Bearer ${tenantB.token}`)
      .set('x-tenant-id', tenantB.id)
      .expect(404); // Tenant B cannot see Tenant A invoice
  });
});
