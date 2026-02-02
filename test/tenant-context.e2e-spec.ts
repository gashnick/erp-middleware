// test/tenant-context.e2e-spec.ts
import * as request from 'supertest';
import {
  setupTestApp,
  teardownTestApp,
  app,
  authService,
  resetDatabase,
} from './test-app.bootstrap';
import { TenantProvisioningService } from '@tenants/tenant-provisioning.service';
import { UsersService } from '../src/users/users.service';

describe('Foundation: Tenant Context & Isolation', () => {
  let tenantsService: TenantProvisioningService;
  let usersService: UsersService;

  beforeAll(async () => {
    await setupTestApp();
    tenantsService = app!.get(TenantProvisioningService);
    usersService = app!.get(UsersService);
  });

  beforeEach(async () => await resetDatabase());

  afterAll(async () => await teardownTestApp());

  it('❌ 7.1: Blocks requests missing tenantId claim (Lobby Mode)', async () => {
    // Sign a JWT without tenantId
    const token = authService.signTestToken({ sub: 'u1' });

    // HTTP Layer: Middleware should reject
    await request(app!.getHttpServer())
      .get('/invoices')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);

    // Service Layer: Direct service calls also reject
    await expect(tenantsService.getInvoicesForTenant('any-id')).rejects.toThrow(
      'Tenant identification required for this resource.',
    );
  });

  it('❌ 7.2: Blocks access to non-existent tenant', async () => {
    const fakeTenantId = '00000000-0000-0000-0000-000000000000';
    const token = authService.signTestToken({ sub: 'u1', tenantId: fakeTenantId });

    // HTTP Layer: Middleware rejects missing tenant schema
    await request(app!.getHttpServer())
      .get('/invoices')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);

    // Verify isolation: no schema physically exists
    const schemas = await tenantsService.listAllTenantSchemas();
    const exists = schemas.find((s: { schemaName: string }) =>
      s.schemaName.includes(fakeTenantId.split('-')[0]),
    );
    expect(exists).toBeUndefined();
  });
});
