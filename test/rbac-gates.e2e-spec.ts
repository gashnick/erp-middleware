// test/rbac-gates-boundary.e2e-spec.ts
import * as request from 'supertest';
import {
  setupTestApp,
  teardownTestApp,
  app,
  resetDatabase,
  createTenantWithUser,
} from './test-app.bootstrap';

describe('Foundation: RBAC Enforcement (Tenant-Isolated)', () => {
  beforeAll(async () => await setupTestApp());
  beforeEach(async () => await resetDatabase());
  afterAll(async () => await teardownTestApp());

  // Each case tests a forbidden action for a role
  const rbacCases: {
    role: 'ADMIN' | 'STAFF' | 'ANALYST';
    action: 'get' | 'post' | 'put' | 'delete' | 'patch';
    endpoint: string;
    expected: number;
  }[] = [
    { role: 'ANALYST', action: 'post', endpoint: '/connectors', expected: 403 },
    { role: 'ANALYST', action: 'delete', endpoint: '/connectors/1', expected: 403 },
    { role: 'STAFF', action: 'get', endpoint: '/connectors', expected: 403 },
  ];

  rbacCases.forEach(({ role, action, endpoint, expected }) => {
    it(`❌ ${role} should be BLOCKED from ${action.toUpperCase()} ${endpoint}`, async () => {
      // createTenantWithUser already returns a tenant with a valid token
      const tenant = await createTenantWithUser(`test-${role.toLowerCase()}@example.com`, role);

      // The token is already a tenant-scoped token signed with tenant secret
      const response = await (request(app!.getHttpServer()) as any)
        [action](endpoint)
        .set('Authorization', `Bearer ${tenant.token}`)
        .set('x-tenant-id', tenant.id);

      expect(response.status).toBe(expected);
    });
  });

  it('✅ ADMIN should be ALLOWED to READ connectors', async () => {
    const admin = await createTenantWithUser('admin-success@test.com', 'ADMIN');

    const response = await request(app!.getHttpServer())
      .get('/connectors')
      .set('Authorization', `Bearer ${admin.token}`)
      .set('x-tenant-id', admin.id);

    expect(response.status).not.toBe(403);
    expect(response.status).not.toBe(401);
  });
});
