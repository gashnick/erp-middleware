import * as request from 'supertest';
import {
  setupTestApp,
  teardownTestApp,
  app,
  resetDatabase,
  createTenantWithUser,
} from './test-app.bootstrap';
import { UserRole } from '@users/dto/create-user.dto';

describe('RBAC Enforcement', () => {
  beforeAll(async () => await setupTestApp());
  beforeEach(async () => await resetDatabase());
  afterAll(async () => await teardownTestApp());

  const rbacCases: Array<{
    role: 'ADMIN' | 'STAFF' | 'ANALYST';
    action: 'post' | 'delete' | 'get';
    endpoint: string;
    expected: number;
  }> = [
    { role: 'ANALYST', action: 'post', endpoint: '/connectors', expected: 403 },
    { role: 'ANALYST', action: 'delete', endpoint: '/connectors/1', expected: 403 },
    { role: 'STAFF', action: 'get', endpoint: '/connectors', expected: 403 },
  ];

  rbacCases.forEach(({ role, action, endpoint, expected }) => {
    it(`${role} cannot perform ${action.toUpperCase()} ${endpoint}`, async () => {
      const tenant = await createTenantWithUser(`test-${role.toLowerCase()}@example.com`, role);
      const res = await (request(app!.getHttpServer()) as any)
        [action](endpoint)
        .set('Authorization', `Bearer ${tenant.token}`)
        .set('x-tenant-id', tenant.id);

      expect(res.status).toBe(expected);
    });
  });

  it('✅ ADMIN can read connectors', async () => {
    const admin = await createTenantWithUser('admin-success@test.com', 'ADMIN');
    const res = await request(app!.getHttpServer())
      .get('/connectors')
      .set('Authorization', `Bearer ${admin.token}`)
      .set('x-tenant-id', admin.id);

    expect(res.status).not.toBe(403);
    expect(res.status).not.toBe(401);
  });
});
