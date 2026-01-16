// test/tenant-isolation.e2e-spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { TenantsService } from '../src/tenants/tenants.service';
import { UsersService } from '@users/users.service';
import { AuthService } from '../src/auth/auth.service';

describe('Tenant Isolation (E2E)', () => {
  let app: INestApplication;
  let tenantsService: TenantsService;
  let usersService: UsersService;
  let authService: AuthService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe());
    await app.init();

    tenantsService = moduleFixture.get<TenantsService>(TenantsService);
    usersService = moduleFixture.get<UsersService>(UsersService);
    authService = moduleFixture.get<AuthService>(AuthService);
  });

  afterAll(async () => {
    await app.close();
  });

  it('should isolate data between tenants', async () => {
    // Create two tenants
    const tenantA = await tenantsService.create({
      companyName: 'Tenant A',
      dataSourceType: 'external',
      subscriptionPlan: 'basic',
    });

    const tenantB = await tenantsService.create({
      companyName: 'Tenant B',
      dataSourceType: 'external',
      subscriptionPlan: 'basic',
    });

    // Create users for each tenant
    const userA = await usersService.create(tenantA.id, {
      email: 'user@tenanta.com',
      password: 'password123',
      fullName: 'User A',
      role: 'admin',
    });

    const userB = await usersService.create(tenantB.id, {
      email: 'user@tenantb.com',
      password: 'password123',
      fullName: 'User B',
      role: 'admin',
    });

    // Login as User A
    const loginA = await authService.login({
      email: 'user@tenanta.com',
      password: 'password123',
    });

    // Login as User B
    const loginB = await authService.login({
      email: 'user@tenantb.com',
      password: 'password123',
    });

    // Create invoice as Tenant A
    const invoiceA = await request(app.getHttpServer())
      .post('/invoices')
      .set('Authorization', `Bearer ${loginA.access_token}`)
      .send({
        invoice_number: 'INV-A-001',
        customer_name: 'Customer A',
        amount: 1000,
      })
      .expect(201);

    // Create invoice as Tenant B
    const invoiceB = await request(app.getHttpServer())
      .post('/invoices')
      .set('Authorization', `Bearer ${loginB.access_token}`)
      .send({
        invoice_number: 'INV-B-001',
        customer_name: 'Customer B',
        amount: 2000,
      })
      .expect(201);

    // Tenant A should only see their invoice
    const invoicesA = await request(app.getHttpServer())
      .get('/invoices')
      .set('Authorization', `Bearer ${loginA.access_token}`)
      .expect(200);

    expect(invoicesA.body).toHaveLength(1);
    expect(invoicesA.body[0].invoice_number).toBe('INV-A-001');
    expect(invoicesA.body[0].amount).toBe(1000);

    // Tenant B should only see their invoice
    const invoicesB = await request(app.getHttpServer())
      .get('/invoices')
      .set('Authorization', `Bearer ${loginB.access_token}`)
      .expect(200);

    expect(invoicesB.body).toHaveLength(1);
    expect(invoicesB.body[0].invoice_number).toBe('INV-B-001');
    expect(invoicesB.body[0].amount).toBe(2000);

    // Tenant A should NOT be able to access Tenant B's invoice
    await request(app.getHttpServer())
      .get(`/invoices/${invoiceB.body.id}`)
      .set('Authorization', `Bearer ${loginA.access_token}`)
      .expect(404); // Not found in Tenant A's schema
  });

  it('should fail if tenant context is missing', async () => {
    // Request without JWT
    await request(app.getHttpServer()).get('/invoices').expect(401); // Unauthorized
  });

  it('should fail if tenant is inactive', async () => {
    // Create tenant
    const tenant = await tenantsService.create({
      companyName: 'Test Tenant',
      dataSourceType: 'external',
      subscriptionPlan: 'basic',
    });

    // Create user
    const user = await usersService.create(tenant.id, {
      email: 'user@test.com',
      password: 'password123',
      fullName: 'Test User',
      role: 'admin',
    });

    // Login
    const login = await authService.login({
      email: 'user@test.com',
      password: 'password123',
    });

    // Suspend tenant
    await tenantsService.update(tenant.id, { status: 'suspended' });

    // Try to access with suspended tenant
    await request(app.getHttpServer())
      .get('/invoices')
      .set('Authorization', `Bearer ${login.access_token}`)
      .expect(401); // Unauthorized
  });
});
