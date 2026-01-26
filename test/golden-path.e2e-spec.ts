// test/golden-path.e2e-spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { UserRole } from '../src/users/dto/create-user.dto';

describe('Golden Path: Full Lifecycle (Month 1)', () => {
  let app: INestApplication;
  let lobbyToken: string;
  let tenantToken: string;
  let quarantinedRecordId: string;

  const testUser = {
    email: `founder_${Date.now()}@acme.com`,
    password: 'SecurePass123!',
    fullName: 'Alex Johnson',
    role: UserRole.ADMIN,
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    await app.init();
  });

  // --- PHASE 1: ONBOARDING ---

  it('1. Register & Login (Public Context)', async () => {
    await request(app.getHttpServer()).post('/auth/register').send(testUser).expect(201);

    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: testUser.email, password: testUser.password })
      .expect(200);

    lobbyToken = loginRes.body.access_token;
    expect(loginRes.body.user.tenantId).toBeNull();
  });

  it('2. Provision Tenant (Schema Creation)', async () => {
    const res = await request(app.getHttpServer())
      .post('/tenants/setup')
      .set('Authorization', `Bearer ${lobbyToken}`)
      .send({
        companyName: 'Acme SaaS',
        subscriptionPlan: 'free', // Matches the 'free' slug in the migration above
        dataSourceType: 'external',
      });

    // Helpful debug log for local development
    if (res.status !== 201) {
      console.log('Provisioning Failed:', res.body);
    }

    expect(res.status).toBe(201);
  });

  it('3. Upgrade Token (Switch to Private Context)', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Authorization', `Bearer ${lobbyToken}`)
      .expect(201);

    tenantToken = res.body.access_token;
    const payload = JSON.parse(Buffer.from(tenantToken.split('.')[1], 'base64').toString());
    expect(payload.tenantId).toBeDefined();
    expect(payload.schemaName).toContain('tenant_');
  });

  // --- PHASE 2: DATA INTAKE & QUARANTINE ---

  it('4. Ingest Messy Data (Split Valid/Quarantine)', async () => {
    const csvContent =
      `customer_name,amount,invoice_number\n` +
      `Good Client,1200.00,INV-001\n` + // Valid
      `,999.00,INV-BAD`; // Invalid (Missing Name)

    const res = await request(app.getHttpServer())
      .post('/connectors/csv-upload')
      .set('Authorization', `Bearer ${tenantToken}`)
      .attach('file', Buffer.from(csvContent), 'data.csv')
      .expect(201);

    expect(res.body.synced).toBe(1);
    expect(res.body.quarantined).toBe(1);
  });

  // --- PHASE 3: REPAIR & FINAL VIEW ---

  it('5. Repair Quarantined Record', async () => {
    // Get the trash
    const listRes = await request(app.getHttpServer())
      .get('/quarantine')
      .set('Authorization', `Bearer ${tenantToken}`)
      .expect(200);

    quarantinedRecordId = listRes.body[0].id;

    // Fix the trash
    await request(app.getHttpServer())
      .post(`/quarantine/${quarantinedRecordId}/retry`)
      .set('Authorization', `Bearer ${tenantToken}`)
      .send({
        customer_name: 'Was Missing Corp',
        amount: 999.0,
        invoice_number: 'INV-BAD-FIXED',
      })
      .expect(201);
  });

  it('6. Verify Final Data Isolation', async () => {
    const res = await request(app.getHttpServer())
      .get('/invoices')
      .set('Authorization', `Bearer ${tenantToken}`)
      .expect(200);

    // Define a quick interface to satisfy TypeScript
    interface InvoiceResult {
      customer_name: string;
      amount: number;
      invoice_number: string;
    }

    // Explicitly type 'i' or the whole array
    expect(res.body.length).toBe(2);
    expect(res.body.some((i: InvoiceResult) => i.customer_name === 'Was Missing Corp')).toBe(true);
  });

  it('7. Verify Audit Trail (Observability)', async () => {
    const res = await request(app.getHttpServer())
      .get('/audit')
      .set('Authorization', `Bearer ${tenantToken}`)
      .expect(200);

    // We expect at least the 'QUARANTINE RETRY' action to be here
    expect(res.body.length).toBeGreaterThanOrEqual(1);

    const repairLog = res.body.find((log: any) => log.action === 'QUARANTINE_RETRY');

    expect(repairLog).toBeDefined();
    expect(repairLog.metadata.recordId).toBe(quarantinedRecordId);
    // Verify the user ID in the log matches the user in our token
    const payload = JSON.parse(Buffer.from(tenantToken.split('.')[1], 'base64').toString());
    expect(repairLog.user_id).toBe(payload.sub);
  });

  afterAll(async () => {
    await app.close();
  });
});
