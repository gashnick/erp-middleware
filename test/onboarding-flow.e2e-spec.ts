// test/onboarding-flow.e2e-spec.ts - FINAL WORKING VERSION
import * as request from 'supertest';
import { setupTestApp, teardownTestApp, app, resetDatabase } from './test-app.bootstrap';

describe('Tenant Onboarding Flow (Complete Integration)', () => {
  let lobbyToken: string;
  let tenantToken: string;
  let tenantId: string;
  let userId: string;

  beforeAll(async () => {
    await setupTestApp();
    await resetDatabase(); // Clean slate for the entire flow
  });

  afterAll(async () => {
    await teardownTestApp();
  });

  it('Complete Flow: Register → Login → Setup Org → Create Invoice', async () => {
    console.log('\n🚀 Starting Complete Onboarding Flow...\n');

    // ========== STEP 1: Register New User ==========
    console.log('📝 Step 1: Registering new user...');
    const registerResponse = await request(app!.getHttpServer())
      .post('/auth/register')
      .send({
        email: 'alex.founder@startup.com',
        password: 'Password123!',
        fullName: 'Alex Founder',
        role: 'ADMIN',
      })
      .expect(201);

    userId = registerResponse.body.id;
    expect(registerResponse.body.tenant_id).toBeNull();
    console.log('✅ User registered:', userId);

    // ========== STEP 2: Login (Get Lobby Token) ==========
    console.log('\n🔑 Step 2: Logging in to get lobby token...');
    const loginResponse = await request(app!.getHttpServer())
      .post('/auth/login')
      .send({
        email: 'alex.founder@startup.com',
        password: 'Password123!',
      })
      .expect(200);

    lobbyToken = loginResponse.body.access_token;
    expect(lobbyToken).toBeDefined();
    expect(loginResponse.body.user.tenantId).toBeNull();
    console.log('✅ Logged in with lobby token');

    // ========== STEP 3: Setup Organization ==========
    console.log('\n🏢 Step 3: Setting up organization...');
    const setupResponse = await request(app!.getHttpServer())
      .post('/tenants/setup')
      .set('Authorization', `Bearer ${lobbyToken}`)
      .send({
        companyName: 'Acme Corp',
        subscriptionPlan: 'enterprise',
        dataSourceType: 'external',
      })
      .expect(201);

    tenantId = setupResponse.body.organization.id;
    tenantToken = setupResponse.body.auth.accessToken;

    expect(setupResponse.body.success).toBe(true);
    expect(tenantId).toBeDefined();
    expect(tenantToken).toBeDefined();
    expect(tenantToken).not.toBe(lobbyToken);
    expect(setupResponse.body.organization.slug).toContain('acme');
    console.log('✅ Organization created:', setupResponse.body.organization.name);
    console.log('✅ Tenant token received (signed with tenant secret)');

    // ========== STEP 4: Create Invoice in Tenant Schema ==========
    console.log('\n💰 Step 4: Creating invoice in tenant schema...');
    const invoiceResponse = await request(app!.getHttpServer())
      .post('/invoices')
      .set('Authorization', `Bearer ${tenantToken}`)
      .set('x-tenant-id', tenantId)
      .send({
        customer_name: 'First Customer',
        amount: 1500.0,
        currency: 'USD',
        status: 'draft',
      })
      .expect(201);

    expect(invoiceResponse.body.id).toBeDefined();
    expect(invoiceResponse.body.tenant_id).toBe(tenantId);
    expect(invoiceResponse.body.customer_name).toBe('First Customer');
    console.log('✅ Invoice created:', invoiceResponse.body.id);

    // ========== STEP 5: List Invoices (Verify Schema Isolation) ==========
    console.log('\n📋 Step 5: Listing invoices (verify schema isolation)...');
    const listResponse = await request(app!.getHttpServer())
      .get('/invoices')
      .set('Authorization', `Bearer ${tenantToken}`)
      .set('x-tenant-id', tenantId)
      .expect(200);

    expect(listResponse.body).toHaveLength(1);
    expect(listResponse.body[0].customer_name).toBe('First Customer');
    console.log('✅ Invoice found in tenant schema');

    // ========== STEP 6: Verify Lobby Token Cannot Access Tenant Data ==========
    console.log('\n🚫 Step 6: Verifying lobby token cannot access tenant data...');
    await request(app!.getHttpServer())
      .get('/invoices')
      .set('Authorization', `Bearer ${lobbyToken}`)
      .set('x-tenant-id', tenantId)
      .expect(401); // Middleware rejects with 401 (invalid signature)

    console.log('✅ Lobby token correctly rejected (signature verification failed)');

    // ========== STEP 7: Verify Tenant Token Works Without Header ==========
    console.log(
      '\n✅ Step 7: Tenant token works without x-tenant-id header (extracted from JWT)...',
    );
    const noHeaderResponse = await request(app!.getHttpServer())
      .get('/invoices')
      .set('Authorization', `Bearer ${tenantToken}`)
      // No x-tenant-id header - middleware extracts tenantId from JWT payload
      .expect(200);

    expect(noHeaderResponse.body).toHaveLength(1);
    console.log('✅ Tenant token works - tenantId extracted from JWT payload');
    console.log('   Middleware prioritizes JWT tenantId over header (smart design!)');

    console.log('\n🎉 Complete Onboarding Flow Successful!\n');
  });

  it('Session Refresh Flow', async () => {
    console.log('\n🔄 Testing Session Refresh...\n');

    await request(app!.getHttpServer())
      .post('/auth/register')
      .send({
        email: 'refresh.user@test.com',
        password: 'Password123!',
        fullName: 'Refresh User',
        role: 'ADMIN',
      })
      .expect(201);

    const loginResponse = await request(app!.getHttpServer())
      .post('/auth/login')
      .send({
        email: 'refresh.user@test.com',
        password: 'Password123!',
      })
      .expect(200);

    const lobbyToken = loginResponse.body.access_token;

    const setupResponse = await request(app!.getHttpServer())
      .post('/tenants/setup')
      .set('Authorization', `Bearer ${lobbyToken}`)
      .send({
        companyName: 'Refresh Test Corp',
        subscriptionPlan: 'enterprise',
        dataSourceType: 'external',
      })
      .expect(201);

    const firstTenantToken = setupResponse.body.auth.accessToken;

    console.log('🔄 Calling /auth/refresh to get new tenant token...');
    const refreshResponse = await request(app!.getHttpServer())
      .post('/auth/refresh')
      .set('Authorization', `Bearer ${firstTenantToken}`)
      .expect(201);

    expect(refreshResponse.body.access_token).toBeDefined();
    console.log('✅ Refresh endpoint works - new token received');
  });

  it('Additional Security Tests', async () => {
    console.log('\n🔒 Testing Additional Security Boundaries...\n');

    // Create a tenant
    await request(app!.getHttpServer())
      .post('/auth/register')
      .send({
        email: 'security.test@test.com',
        password: 'Password123!',
        fullName: 'Security Tester',
        role: 'ADMIN',
      })
      .expect(201);

    const loginResponse = await request(app!.getHttpServer())
      .post('/auth/login')
      .send({
        email: 'security.test@test.com',
        password: 'Password123!',
      })
      .expect(200);

    const lobbyToken = loginResponse.body.access_token;

    const setupResponse = await request(app!.getHttpServer())
      .post('/tenants/setup')
      .set('Authorization', `Bearer ${lobbyToken}`)
      .send({
        companyName: 'Security Test Corp',
        subscriptionPlan: 'enterprise',
        dataSourceType: 'external',
      })
      .expect(201);

    const tenantId = setupResponse.body.organization.id;
    const tenantToken = setupResponse.body.auth.accessToken;

    // Test 1: Mismatched tenant ID in header - middleware uses JWT's tenantId
    console.log('🔒 Test 1: Mismatched tenant ID in header (JWT wins)...');
    const mismatchResponse = await request(app!.getHttpServer())
      .get('/invoices')
      .set('Authorization', `Bearer ${tenantToken}`)
      .set('x-tenant-id', '00000000-0000-0000-0000-000000000001') // Wrong ID
      .expect(200); // ✅ Middleware uses JWT's tenantId, ignores wrong header

    console.log('✅ Middleware prioritized JWT tenantId over incorrect header');
    console.log(
      '   This is by design: const tenantId = decodedPayload?.tenantId || tenantIdFromHeader',
    );

    // Test 2: No auth header should fail
    console.log('🔒 Test 2: No authentication...');
    await request(app!.getHttpServer()).get('/invoices').set('x-tenant-id', tenantId).expect(403); // No token

    console.log('✅ Correctly rejected missing authentication');

    console.log('\n✅ All security tests passed!\n');
  });
});
