import { INestApplication } from '@nestjs/common';
import {
  setupTestApp,
  teardownTestApp,
  resetDatabase,
  createTenantWithUser,
} from '../../setup/test-app.bootstrap';
import { publicRequest, authenticatedRequest } from '../../setup/test-helpers';
import { userFactory, organizationFactory } from '../../setup/test-data-factories';

describe('Tenant Users (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await setupTestApp();
  });

  afterAll(async () => {
    await teardownTestApp();
  });

  beforeEach(async () => {
    await resetDatabase();
  });

  describe('User Registration and Tenant Provisioning', () => {
    it('should register, login, and provision organization', async () => {
      const userData = userFactory.validRegistration();

      // Register new user
      await publicRequest(app).post('/auth/register').send(userData).expect(201);

      // Login
      const login = await publicRequest(app)
        .post('/auth/login')
        .send({ email: userData.email, password: userData.password })
        .expect(200);

      expect(login.body).toHaveProperty('access_token');
      const token = login.body.access_token;

      // Create organization (provision tenant)
      const org = organizationFactory.validOrganization();
      const provisioning = await authenticatedRequest(app, token)
        .post('/provisioning/organizations')
        .send(org)
        .expect(201);

      expect(provisioning.body).toMatchObject({
        success: true,
        organization: {
          id: expect.any(String),
          name: expect.any(String),
        },
        auth: {
          accessToken: expect.any(String),
        },
      });

      // Use upgraded tenant token
      const tenantToken = provisioning.body.auth.accessToken;

      // Should be able to access tenant-scoped endpoints
      await authenticatedRequest(app, tenantToken).get('/connectors').expect(200);
    });

    it('should upgrade session to tenant context after organization creation', async () => {
      const userData = userFactory.validRegistration();

      await publicRequest(app).post('/auth/register').send(userData).expect(201);

      const login = await publicRequest(app)
        .post('/auth/login')
        .send({ email: userData.email, password: userData.password })
        .expect(200);

      const publicToken = login.body.access_token;

      // Create organization
      const org = organizationFactory.validOrganization();
      const provisioning = await authenticatedRequest(app, publicToken)
        .post('/provisioning/organizations')
        .send(org)
        .expect(201);

      const tenantToken = provisioning.body.auth.accessToken;

      // Verify token has tenant context
      expect(tenantToken).toBeDefined();
      expect(tenantToken).not.toBe(publicToken);

      // Tenant token should work for tenant endpoints
      const response = await authenticatedRequest(app, tenantToken).get('/users').expect(200);

      expect(response.body).toBeDefined();
    });
  });

  describe('Tenant User Management', () => {
    it('should allow ADMIN to create new users in tenant', async () => {
      const tenant = await createTenantWithUser('admin@test.com', 'ADMIN');

      const newUserData = {
        email: `staff-${Date.now()}@test.com`,
        password: 'Password123!',
        role: 'STAFF',
        fullName: 'New Staff Member',
      };

      const response = await authenticatedRequest(app, tenant.token)
        .post('/users')
        .send(newUserData)
        .expect(201);

      expect(response.body).toMatchObject({
        id: expect.any(String),
        email: newUserData.email,
        role: 'STAFF',
      });
      expect(response.body.password).toBeUndefined();
      expect(response.body.passwordHash).toBeUndefined();
    });

    it('should list users within tenant scope only', async () => {
      const tenant1 = await createTenantWithUser('tenant1@test.com', 'ADMIN');
      const tenant2 = await createTenantWithUser('tenant2@test.com', 'ADMIN');

      // Create user in tenant1
      await authenticatedRequest(app, tenant1.token)
        .post('/users')
        .send({
          email: 'user-tenant1@test.com',
          password: 'Password123!',
          role: 'STAFF',
          fullName: 'Tenant 1 User',
        })
        .expect(201);

      // Tenant1 should see their users
      const users1 = await authenticatedRequest(app, tenant1.token).get('/users').expect(200);

      expect(users1.body).toBeDefined();
      expect(Array.isArray(users1.body)).toBe(true);
      expect(users1.body.length).toBeGreaterThan(0);

      // Tenant2 should not see tenant1's users
      const users2 = await authenticatedRequest(app, tenant2.token).get('/users').expect(200);

      expect(users2.body).toBeDefined();
      // Should not include tenant1's specific user
      const tenant1User = users2.body.find((u: any) => u.email === 'user-tenant1@test.com');
      expect(tenant1User).toBeUndefined();
    });

    it('should update user within same tenant', async () => {
      const tenant = await createTenantWithUser('update@test.com', 'ADMIN');

      // Create a user
      const createResponse = await authenticatedRequest(app, tenant.token)
        .post('/users')
        .send({
          email: 'user-to-update@test.com',
          password: 'Password123!',
          role: 'STAFF',
          fullName: 'Original Name',
        })
        .expect(201);

      const userId = createResponse.body.id;

      // Update the user
      const updateResponse = await authenticatedRequest(app, tenant.token)
        .patch(`/users/${userId}`)
        .send({
          fullName: 'Updated Name',
        })
        .expect(200);

      expect(updateResponse.body.fullName).toBe('Updated Name');
    });

    it('should delete user within same tenant', async () => {
      const tenant = await createTenantWithUser('delete@test.com', 'ADMIN');

      // Create a user
      const createResponse = await authenticatedRequest(app, tenant.token)
        .post('/users')
        .send({
          email: 'user-to-delete@test.com',
          password: 'Password123!',
          role: 'STAFF',
          fullName: 'To Delete',
        })
        .expect(201);

      const userId = createResponse.body.id;

      // Delete the user
      await authenticatedRequest(app, tenant.token).delete(`/users/${userId}`).expect(200);

      // Verify user is deleted
      await authenticatedRequest(app, tenant.token).get(`/users/${userId}`).expect(404);
    });

    it('should prevent STAFF from creating users', async () => {
      const tenant = await createTenantWithUser('staff@test.com', 'STAFF');

      const newUserData = {
        email: `unauthorized-${Date.now()}@test.com`,
        password: 'Password123!',
        role: 'STAFF',
        fullName: 'Unauthorized User',
      };

      await authenticatedRequest(app, tenant.token).post('/users').send(newUserData).expect(403);
    });
  });

  describe('User Roles and Permissions', () => {
    it('should assign correct role during user creation', async () => {
      const tenant = await createTenantWithUser('roles@test.com', 'ADMIN');

      const analystUser = await authenticatedRequest(app, tenant.token)
        .post('/users')
        .send({
          email: 'analyst@test.com',
          password: 'Password123!',
          role: 'ANALYST',
          fullName: 'Analyst User',
        })
        .expect(201);

      expect(analystUser.body.role).toBe('ANALYST');

      const staffUser = await authenticatedRequest(app, tenant.token)
        .post('/users')
        .send({
          email: 'staff@test.com',
          password: 'Password123!',
          role: 'STAFF',
          fullName: 'Staff User',
        })
        .expect(201);

      expect(staffUser.body.role).toBe('STAFF');
    });

    it('should allow ADMIN to change user roles', async () => {
      const tenant = await createTenantWithUser('change-role@test.com', 'ADMIN');

      const user = await authenticatedRequest(app, tenant.token)
        .post('/users')
        .send({
          email: 'role-change@test.com',
          password: 'Password123!',
          role: 'STAFF',
          fullName: 'Role Change User',
        })
        .expect(201);

      // Promote to ANALYST
      const updated = await authenticatedRequest(app, tenant.token)
        .patch(`/users/${user.body.id}`)
        .send({ role: 'ANALYST' })
        .expect(200);

      expect(updated.body.role).toBe('ANALYST');
    });

    it('should retrieve current user profile', async () => {
      const tenant = await createTenantWithUser('profile@test.com', 'ADMIN');

      const profile = await authenticatedRequest(app, tenant.token).get('/users/me').expect(200);

      expect(profile.body).toMatchObject({
        id: expect.any(String),
        email: expect.any(String),
        role: 'ADMIN',
      });
    });
  });

  describe('User Validation', () => {
    it('should reject invalid email format', async () => {
      const tenant = await createTenantWithUser('validation@test.com', 'ADMIN');

      await authenticatedRequest(app, tenant.token)
        .post('/users')
        .send({
          email: 'invalid-email',
          password: 'Password123!',
          role: 'STAFF',
          fullName: 'Invalid Email',
        })
        .expect(400);
    });

    it('should reject weak passwords', async () => {
      const tenant = await createTenantWithUser('weak-pass@test.com', 'ADMIN');

      await authenticatedRequest(app, tenant.token)
        .post('/users')
        .send({
          email: 'weak@test.com',
          password: 'weak',
          role: 'STAFF',
          fullName: 'Weak Password',
        })
        .expect(400);
    });

    it('should prevent duplicate email within tenant', async () => {
      const tenant = await createTenantWithUser('duplicate@test.com', 'ADMIN');

      const userData = {
        email: 'duplicate-user@test.com',
        password: 'Password123!',
        role: 'STAFF',
        fullName: 'Duplicate User',
      };

      // First creation
      await authenticatedRequest(app, tenant.token).post('/users').send(userData).expect(201);

      // Duplicate creation
      await authenticatedRequest(app, tenant.token).post('/users').send(userData).expect(409);
    });

    it('should require all mandatory fields', async () => {
      const tenant = await createTenantWithUser('mandatory@test.com', 'ADMIN');

      // Missing password
      await authenticatedRequest(app, tenant.token)
        .post('/users')
        .send({
          email: 'missing-pass@test.com',
          role: 'STAFF',
          fullName: 'Missing Password',
        })
        .expect(400);

      // Missing email
      await authenticatedRequest(app, tenant.token)
        .post('/users')
        .send({
          password: 'Password123!',
          role: 'STAFF',
          fullName: 'Missing Email',
        })
        .expect(400);
    });
  });
});
