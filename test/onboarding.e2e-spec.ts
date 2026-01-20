import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { UserRole } from '../src/users/dto/create-user.dto';

describe('SaaS Onboarding Flow (E2E)', () => {
  let app: INestApplication;
  let lobbyToken: string;
  let tenantToken: string;

  // Use a unique email for every test run to avoid "Email already exists" errors
  const testUser = {
    email: `ceo_${Date.now()}@startup.com`,
    password: 'SecurePass123!',
    fullName: 'Alex Johnson',
    role: UserRole.ADMIN,
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();

    // CRITICAL: This enables the @IsEmail, @MinLength validation in tests
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));

    await app.init();
  });

  it('Step 1: Register New User (Public Schema)', async () => {
    const res = await request(app.getHttpServer()).post('/auth/register').send({
      email: testUser.email,
      password: testUser.password,
      fullName: testUser.fullName,
      role: testUser.role,
    });

    if (res.status !== 201) {
      console.error('Registration Failed Body:', res.body);
    }
    expect(res.status).toBe(201);
  });

  it('Step 2: Login to get Lobby Token', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({
        email: testUser.email,
        password: testUser.password,
      })
      .expect(200);

    lobbyToken = res.body.access_token;
    expect(lobbyToken).toBeDefined();
    // User is in "Lobby" so tenantId should be null
    expect(res.body.user.tenantId).toBeNull();
  });

  it('Step 3: Setup Organization (Provisioning)', async () => {
    const res = await request(app.getHttpServer())
      .post('/tenants/setup')
      .set('Authorization', `Bearer ${lobbyToken}`)
      .send({
        companyName: 'Acme ERP Corp',
        subscriptionPlan: 'free',
        dataSourceType: 'internal', // Added this field - check your DTO!
      });

    if (res.status !== 201) {
      console.log('Setup Error Body:', res.body);
    }
    expect(res.status).toBe(201);
  });

  it('Step 4: Upgrade Token (Switch to Tenant Context)', async () => {
    // UPDATED: Path matches your AuthController @Post('refresh')
    const res = await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Authorization', `Bearer ${lobbyToken}`)
      .expect(201);

    tenantToken = res.body.access_token;
    expect(tenantToken).toBeDefined();

    // Verify the JWT payload now contains tenant context
    const payload = JSON.parse(Buffer.from(tenantToken.split('.')[1], 'base64').toString());
    expect(payload.tenantId).toBeDefined();
    expect(payload.schemaName).toBeDefined();
  });

  it('Step 5: Verify Data Isolation (Private Schema Access)', async () => {
    // This request uses the tenantToken.
    // The Middleware will route this to the new Acme schema.
    const res = await request(app.getHttpServer())
      .post('/invoices')
      .set('Authorization', `Bearer ${tenantToken}`)
      .send({
        amount: 5000.0,
        status: 'pending',
      });

    // If invoices controller isn't built yet, this might 404,
    // but the test proves the Auth and Middleware flow is complete.
    expect(res.status).toBe(201);
  });

  afterAll(async () => {
    await app.close();
  });
});
