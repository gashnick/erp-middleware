import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Tenant Onboarding Flow (Integration)', () => {
  let app: INestApplication;
  let lobbyToken: string;
  let tenantToken: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('Step 1: Login as a New User (Lobby Mode)', async () => {
    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'alex.founder@startup.com', password: 'Password123' })
      .expect(200);

    lobbyToken = response.body.access_token;
    // Verify tenantId is null in the "Lobby"
    expect(response.body.user.tenantId).toBeNull();
  });

  it('Step 2: Setup Organization (Infrastructure Provisioning)', async () => {
    const response = await request(app.getHttpServer())
      .post('/tenants/setup')
      .set('Authorization', `Bearer ${lobbyToken}`)
      .send({
        companyName: 'Acme Corp',
        subscriptionPlan: 'free',
        dataSourceType: 'external',
      })
      .expect(201);

    expect(response.body.schemaName).toContain('tenant_acme');
  });

  it('Step 3: Upgrade Token (Silent Identity Upgrade)', async () => {
    const response = await request(app.getHttpServer())
      .post('/tenants/refresh-token')
      .set('Authorization', `Bearer ${lobbyToken}`)
      .expect(201);

    tenantToken = response.body.access_token;
    // Verify the new token now has the tenant context
    expect(response.body.user.tenantId).toBeDefined();
    expect(response.body.user.schemaName).toContain('tenant_acme');
  });

  it('Step 4: Create Data in Private Schema', async () => {
    // This request uses the tenantToken.
    // The Middleware should automatically point this to the Acme schema.
    await request(app.getHttpServer())
      .post('/invoices')
      .set('Authorization', `Bearer ${tenantToken}`)
      .send({ amount: 1500.0, status: 'draft' })
      .expect(201);
  });

  afterAll(async () => {
    await app.close();
  });
});
