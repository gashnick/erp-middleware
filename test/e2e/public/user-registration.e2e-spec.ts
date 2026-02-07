import { INestApplication } from '@nestjs/common';
import { setupTestApp, teardownTestApp, resetDatabase } from '../../setup/test-app.bootstrap';
import { publicRequest } from '../../setup/test-helpers';
import { userFactory } from '../../setup/test-data-factories';

describe('User Registration (Public Routes)', () => {
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

  describe('POST /auth/register', () => {
    it('should register a new user with valid data', async () => {
      const userData = userFactory.validRegistration();

      const response = await publicRequest(app).post('/auth/register').send(userData).expect(201);

      expect(response.body).toMatchObject({
        id: expect.any(String),
        email: userData.email,
      });
      expect(response.body.password).toBeUndefined();
    });

    it('should enforce email uniqueness', async () => {
      const userData = userFactory.validRegistration();

      // First registration
      await publicRequest(app).post('/auth/register').send(userData).expect(201);

      // Duplicate registration should fail
      await publicRequest(app).post('/auth/register').send(userData).expect(409);
    });

    it('should validate required fields', async () => {
      await publicRequest(app).post('/auth/register').send({}).expect(400);
    });
  });
});
