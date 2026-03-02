import { Injectable, Logger } from '@nestjs/common';
import { TenantQueryRunnerService } from '@database/tenant-query-runner.service';
import { KnowledgeGraphRepository } from './knowledge-graph.repository';
import { tenantContext, UserRole } from '@common/context/tenant-context';

@Injectable()
export class GraphBuilderService {
  private readonly logger = new Logger(GraphBuilderService.name);

  private static readonly GET_CUSTOMERS_SQL = `SELECT id, name FROM public.customers WHERE tenant_id = $1`;
  private static readonly GET_VENDORS_SQL = `SELECT id, name FROM public.vendors WHERE tenant_id = $1`;
  private static readonly GET_INVOICES_SQL = `
    SELECT id, invoice_number AS number, customer_id AS "customerId", vendor_id AS "vendorId"
    FROM public.invoices
    WHERE tenant_id = $1
  `;

  constructor(
    private readonly repo: KnowledgeGraphRepository,
    private readonly tenantDb: TenantQueryRunnerService,
  ) {}

  async buildForTenant(tenantId: string): Promise<void> {
    this.logger.log(`Building KG for tenant ${tenantId}`);

    // 1. Fetch source data from the shared public schema
    const [customers, vendors, invoices] = await Promise.all([
      this.tenantDb.executePublic<{ id: string; name: string }>(
        GraphBuilderService.GET_CUSTOMERS_SQL,
        [tenantId],
      ),
      this.tenantDb.executePublic<{ id: string; name: string }>(
        GraphBuilderService.GET_VENDORS_SQL,
        [tenantId],
      ),
      this.tenantDb.executePublic<{
        id: string;
        number: string;
        customerId: string;
        vendorId: string;
      }>(GraphBuilderService.GET_INVOICES_SQL, [tenantId]),
    ]);

    // 2. Resolve schema name for the target tenant
    const tenantInfoRows = await this.tenantDb.executePublic<{ schema_name: string }>(
      'SELECT schema_name FROM public.tenants WHERE id = $1',
      [tenantId],
    );

    const tenantInfo = tenantInfoRows[0];
    if (!tenantInfo) throw new Error(`Tenant ${tenantId} not found`);

    // 3. Establish System Context and build the Graph in the private schema
    await tenantContext.run(
      {
        tenantId,
        schemaName: tenantInfo.schema_name,
        userId: 'system-builder',
        userEmail: 'system-builder@platform.local', // Fixed: Added required property
        userRole: UserRole.SYSTEM_JOB,
        requestId: `kg-build-${tenantId}-${Date.now()}`,
        timestamp: new Date(),
      },
      async () => {
        // Upsert Customers
        for (const c of customers) {
          await this.repo.upsertEntity('CUSTOMER', c.id, c.name);
        }

        // Upsert Suppliers
        for (const v of vendors) {
          await this.repo.upsertEntity('SUPPLIER', v.id, v.name);
        }

        // Upsert Invoices and their relationships
        for (const inv of invoices) {
          const invEntity = await this.repo.upsertEntity(
            'INVOICE',
            inv.id,
            `Invoice ${inv.number}`,
          );

          const customerEntity = await this.repo.upsertEntity(
            'CUSTOMER',
            inv.customerId,
            inv.customerId,
          );

          const supplierEntity = await this.repo.upsertEntity(
            'SUPPLIER',
            inv.vendorId,
            inv.vendorId,
          );

          await this.repo.upsertRelationship(invEntity.id, customerEntity.id, 'ISSUED_TO');
          await this.repo.upsertRelationship(invEntity.id, supplierEntity.id, 'SUPPLIED_BY');
        }
      },
    );

    this.logger.log(
      `KG built for tenant ${tenantId}: ${customers.length} customers, ${vendors.length} vendors, ${invoices.length} invoices`,
    );
  }
}
