// test/security-encryption.e2e-spec.ts
import * as request from 'supertest';
import {
  setupTestApp,
  teardownTestApp,
  app,
  db,
  resetDatabase,
  createTenantWithUser,
} from './test-app.bootstrap';
import { runWithTenantContext } from '@common/context/tenant-context';

describe('Foundation: Sensitive Data Encryption', () => {
  beforeAll(async () => await setupTestApp());
  beforeEach(async () => await resetDatabase());
  afterAll(async () => await teardownTestApp());

  it('✅ 6.1: Stores sensitive fields encrypted in tenant schema', async () => {
    // 1️⃣ Create a fresh tenant and admin user
    const {
      token,
      id: tenantId,
      schemaName,
    } = await createTenantWithUser('security-admin@test.com', 'ADMIN');

    const sensitiveCustomerName = 'High Value Client';

    // 2️⃣ Create invoice via API; flag triggers encryption logic
    const res = await request(app!.getHttpServer())
      .post('/invoices')
      .set('Authorization', `Bearer ${token}`)
      .set('x-tenant-id', tenantId)
      .send({
        customer_name: sensitiveCustomerName,
        amount: 15000,
        external_id: 'SECURE-INV-99',
        is_encrypted: true, // triggers encryption on storage
      });

    expect(res.status).toBe(201);
    // API returns DECRYPTED value for authorized users
    expect(res.body.customer_name).toBe(sensitiveCustomerName);

    // 3️⃣ Verify DB directly in tenant schema: should be encrypted
    await runWithTenantContext({ tenantId, userId: 'DB_VERIFIER', schemaName }, async () => {
      const runner = await db.getRunner();
      try {
        const rawRows = await runner.query(
          `SELECT customer_name FROM "${schemaName}"."invoices" WHERE external_id = $1`,
          ['SECURE-INV-99'],
        );

        const storedValue = rawRows[0].customer_name;

        // ASSERTION: Raw DB value must be encrypted
        expect(storedValue).not.toBe(sensitiveCustomerName);
        expect(storedValue).toContain('enc:'); // matches encryption prefix
      } finally {
        await runner.release();
      }
    });
  });
});
