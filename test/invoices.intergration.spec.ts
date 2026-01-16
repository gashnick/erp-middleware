// test/invoices.integration.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { InvoicesService } from '../src/finance/invoices/invoices.service';
import { TenantsService } from '../src/tenants/tenants.service';
import { Tenant } from '../src/tenants/entities/tenant.entity';
import { tenantContext } from '../src/common/context/tenant-context';

describe('Invoices Integration Tests', () => {
  let app: TestingModule;
  let invoicesService: InvoicesService;
  let tenantsService: TenantsService;
  let testTenant: Tenant;

  beforeAll(async () => {
    app = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    invoicesService = app.get<InvoicesService>(InvoicesService);
    tenantsService = app.get<TenantsService>(TenantsService);

    // Create test tenant
    testTenant = await tenantsService.create({
      companyName: 'Integration Test Tenant',
      dataSourceType: 'external',
      subscriptionPlan: 'basic',
    });
  });

  afterAll(async () => {
    // Clean up test tenant
    await tenantsService.permanentDelete(testTenant.id);
    await app.close();
  });

  it('should create and retrieve invoice', async () => {
    // Set tenant context
    await tenantContext.run(
      {
        tenantId: testTenant.id,
        userId: 'test-user',
        requestId: 'test-request',
        schemaName: testTenant.schemaName,
        userEmail: 'test@example.com',
        userRole: 'admin',
        timestamp: new Date(),
      },
      async () => {
        // Create invoice
        const created = await invoicesService.create({
          invoice_number: 'INT-TEST-001',
          customer_name: 'Test Customer',
          amount: 5000,
        });

        expect(created).toBeDefined();
        expect(created.invoice_number).toBe('INT-TEST-001');
        expect(created.amount).toBe(5000);

        // Retrieve invoice
        const retrieved = await invoicesService.findById(created.id);
        expect(retrieved).toEqual(created);

        // List invoices
        const all = await invoicesService.findAll();
        expect(all.length).toBeGreaterThan(0);
        expect(all.find((i) => i.id === created.id)).toBeDefined();
      },
    );
  });
});
