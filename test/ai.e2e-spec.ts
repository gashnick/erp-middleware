import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../../app.module';

describe('AI Controller (e2e)', () => {
  let app: INestApplication;
  let tenantToken: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    // Setup: Create user, login, create tenant
    await request(app.getHttpServer()).post('/api/auth/register').send({
      email: 'ai-test@example.com',
      password: 'SecurePass123!',
      fullName: 'AI Test User',
      role: 'ADMIN',
    });

    const loginResponse = await request(app.getHttpServer()).post('/api/auth/login').send({
      email: 'ai-test@example.com',
      password: 'SecurePass123!',
    });

    const publicToken = loginResponse.body.access_token;

    const tenantResponse = await request(app.getHttpServer())
      .post('/api/tenants')
      .set('Authorization', `Bearer ${publicToken}`)
      .send({
        companyName: 'AI Test Corp',
        dataSourceType: 'external',
        subscriptionPlan: 'enterprise',
      });

    tenantToken = tenantResponse.body.auth.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('/api/ai/chat (POST)', () => {
    it('should return 401 without authentication', () => {
      return request(app.getHttpServer())
        .post('/api/ai/chat')
        .send({ query: 'Show revenue' })
        .expect(401);
    });

    it('should process chat query with authentication', () => {
      return request(app.getHttpServer())
        .post('/api/ai/chat')
        .set('Authorization', `Bearer ${tenantToken}`)
        .send({
          query: 'Show revenue for this month',
          preferredFormat: 'text',
        })
        .expect(200)
        .expect((res) => {
          expect(res.body).toHaveProperty('sessionId');
          expect(res.body).toHaveProperty('response');
          expect(res.body).toHaveProperty('confidence');
        });
    });
  });

  describe('/api/ai/analytics/revenue (GET)', () => {
    it('should return revenue analytics', () => {
      return request(app.getHttpServer())
        .get('/api/ai/analytics/revenue')
        .set('Authorization', `Bearer ${tenantToken}`)
        .query({
          startDate: '2024-01-01',
          endDate: '2024-12-31',
          groupBy: 'month',
        })
        .expect(200)
        .expect((res) => {
          expect(Array.isArray(res.body)).toBe(true);
        });
    });
  });

  describe('/api/ai/anomalies (GET)', () => {
    it('should detect anomalies', () => {
      return request(app.getHttpServer())
        .get('/api/ai/anomalies')
        .set('Authorization', `Bearer ${tenantToken}`)
        .expect(200)
        .expect((res) => {
          expect(res.body).toHaveProperty('anomalies');
          expect(res.body).toHaveProperty('totalCount');
          expect(res.body).toHaveProperty('highSeverityCount');
        });
    });
  });

  describe('Rate Limiting', () => {
    it('should enforce rate limits', async () => {
      const requests = [];

      // Make 101 requests (enterprise limit is 100)
      for (let i = 0; i < 101; i++) {
        requests.push(
          request(app.getHttpServer())
            .get('/api/ai/analytics/insights')
            .set('Authorization', `Bearer ${tenantToken}`),
        );
      }

      const responses = await Promise.all(requests);
      const rateLimited = responses.some((r) => r.status === 429);

      expect(rateLimited).toBe(true);
    });
  });
});
