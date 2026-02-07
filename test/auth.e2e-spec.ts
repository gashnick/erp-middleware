import request from 'supertest';
import {
  app,
  setupTestApp,
  teardownTestApp,
  resetDatabase,
  createTenantWithUser,
} from './setup/test-app.bootstrap';

describe('Authentication & Identity (e2e)', () => {
  beforeAll(async () => {
    await setupTestApp();
  });

  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await teardownTestApp();
  });

  describe('Registration & System Login', () => {
    const testUser = {
      email: 'engineer@example.com',
      password: 'Password123!',
      fullName: 'Senior Dev',
      role: 'ADMIN',
    };

    it('should register a public user and allow login', async () => {
      // 1. Register
      await request(app!.getHttpServer()).post('/auth/register').send(testUser).expect(201);

      // 2. Login
      const loginRes = await request(app!.getHttpServer())
        .post('/auth/login')
        .send({ email: testUser.email, password: testUser.password })
        .expect(200);

      expect(loginRes.body).toHaveProperty('access_token');
      expect(loginRes.body.user.tenantId).toBeNull(); // System level
    });
  });

  describe('Tenant Promotion (The Secure Flow)', () => {
    it('should promote a system user to a tenant-level session', async () => {
      // 1. Setup: Create a tenant and user via bootstrap helper
      const email = `tenant-${Date.now()}@test.com`;
      const { token: systemToken } = await createTenantWithUser(email, 'ADMIN');

      // 2. Promote: Exchange System JWT for Tenant JWT
      const promoteRes = await request(app!.getHttpServer())
        .post('/auth/promote')
        .set('Authorization', `Bearer ${systemToken}`)
        .expect(200);

      expect(promoteRes.body).toHaveProperty('access_token');
      expect(promoteRes.body).toHaveProperty('refresh_token');

      // 3. Verify: Use the NEW Tenant JWT to access /users/me
      const tenantToken = promoteRes.body.access_token;
      const profileRes = await request(app!.getHttpServer())
        .get('/users/me')
        .set('Authorization', `Bearer ${tenantToken}`)
        .expect(200);

      expect(profileRes.body.tenant_id).not.toBeNull();
      expect(profileRes.body.email).toBe(email);
    });

    it('should fail promotion if the user has no tenant link', async () => {
      // Register a user but DON'T create an organization for them
      await request(app!.getHttpServer()).post('/auth/register').send({
        email: 'solo@test.com',
        password: 'Password123!',
        fullName: 'Solo',
        role: 'ADMIN',
      });

      const loginRes = await request(app!.getHttpServer())
        .post('/auth/login')
        .send({ email: 'solo@test.com', password: 'Password123!' });

      const systemToken = loginRes.body.access_token;

      // Try to promote
      await request(app!.getHttpServer())
        .post('/auth/promote')
        .set('Authorization', `Bearer ${systemToken}`)
        .expect(401); // User not linked to tenant
    });
  });
});
