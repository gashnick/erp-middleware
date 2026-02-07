import { INestApplication } from '@nestjs/common';
import { setupTestApp, teardownTestApp, resetDatabase } from '../../setup/test-app.bootstrap';
import { publicRequest } from '../../setup/test-helpers';

describe('Subscription Plans (Public Routes)', () => {
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

  describe('GET /subscription-plans', () => {
    it('should return available subscription plans', async () => {
      const response = await publicRequest(app).get('/subscription-plans').expect(200);

      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBeGreaterThan(0);

      // Should have at least Free and Enterprise plans
      const planSlugs = response.body.map((plan: any) => plan.slug);
      expect(planSlugs).toContain('free');
      expect(planSlugs).toContain('enterprise');
    });

    it('should return plan details with pricing', async () => {
      const response = await publicRequest(app).get('/subscription-plans').expect(200);

      const enterprisePlan = response.body.find((plan: any) => plan.slug === 'enterprise');

      expect(enterprisePlan).toMatchObject({
        name: expect.any(String),
        slug: 'enterprise',
        description: expect.any(String),
        price_monthly: expect.stringMatching(/^\d+\.\d{2}$/),
        max_users: expect.any(Number),
        max_storage_gb: expect.any(Number),
      });
    });
  });

  describe('GET /subscription-plans/:slug', () => {
    it('should return specific plan by slug', async () => {
      const response = await publicRequest(app).get('/subscription-plans/enterprise').expect(200);

      expect(response.body).toMatchObject({
        slug: 'enterprise',
        name: 'Enterprise',
      });
    });

    it('should return 404 for non-existent plan', async () => {
      await publicRequest(app).get('/subscription-plans/nonexistent').expect(404);
    });
  });
});
