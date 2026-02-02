// test/auth-boundary.e2e-spec.ts
import * as request from 'supertest';
import {
  setupTestApp,
  teardownTestApp,
  app,
  authService,
  usersService,
  resetDatabase,
} from './test-app.bootstrap';
import { UserRole } from '@users/dto/create-user.dto';

describe('Foundation: Auth & Tenant Boundary', () => {
  let orphanToken: string;

  beforeAll(async () => await setupTestApp());
  beforeEach(async () => await resetDatabase());
  afterAll(async () => await teardownTestApp());

  it('❌ 1.1: Rejects requests missing tenant header', async () => {
    await request(app!.getHttpServer()).get('/invoices').expect(403); // Middleware blocks before JWT guard
  });

  it('❌ 1.2: Rejects requests with missing tenant header and invalid token', async () => {
    await request(app!.getHttpServer())
      .get('/invoices')
      .set('Authorization', 'Bearer invalid.token.here')
      .expect(403); // Middleware still blocks first
  });

  it('❌ 1.3: Rejects valid JWT with lobby (null) tenant ID', async () => {
    const userWithoutTenant = await usersService.create(null, {
      email: `orphan_${Date.now()}@example.com`,
      password: 'Password123!',
      fullName: 'Orphan User',
      role: UserRole.ADMIN,
    });

    const loginResponse = await authService.login(userWithoutTenant);
    orphanToken = loginResponse.access_token;

    await request(app!.getHttpServer())
      .get('/invoices')
      .set('Authorization', `Bearer ${orphanToken}`)
      .set('x-tenant-id', '00000000-0000-0000-0000-000000000000')
      .expect(403); // Lobby tenant does not exist
  });

  it('❌ 1.4: Rejects valid JWT with non-existent tenant ID', async () => {
    const userWithoutTenant = await usersService.create(null, {
      email: `orphan2_${Date.now()}@example.com`,
      password: 'Password123!',
      fullName: 'Another Orphan',
      role: UserRole.ADMIN,
    });

    const loginResponse = await authService.login(userWithoutTenant);
    const token = loginResponse.access_token;

    await request(app!.getHttpServer())
      .get('/invoices')
      .set('Authorization', `Bearer ${token}`)
      .set('x-tenant-id', 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')
      .expect(403); // Tenant not found
  });
});
