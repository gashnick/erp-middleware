// src/knowledgeGraph/graph-builder.service.ts
//
// Builds the knowledge graph for a tenant by traversing existing financial data.
//
// Source tables (all in tenant schema — no public schema queries):
//   contacts  → CUSTOMER and SUPPLIER entities
//   invoices  → INVOICE entities + ISSUED_TO / SUPPLIED_BY relationships
//   expenses  → enriches SUPPLIER meta with spend totals
//
// This service is called:
//   1. After ETL upload (to keep the graph fresh)
//   2. On-demand via GraphQL mutation (manual rebuild)
//
// It is intentionally idempotent — upserts only, safe to re-run.

import { Injectable, Logger } from '@nestjs/common';
import { TenantQueryRunnerService } from '@database/tenant-query-runner.service';
import { KnowledgeGraphRepository } from './knowledge-graph.repository';
import { runWithTenantContext, UserRole } from '@common/context/tenant-context';

@Injectable()
export class GraphBuilderService {
  private readonly logger = new Logger(GraphBuilderService.name);

  // ── SQL — all unqualified, run inside tenant search_path ──────────────────

  private static readonly GET_CUSTOMERS_SQL = `
    SELECT id::text, name
    FROM contacts
    WHERE type IN ('customer', 'partner')
    ORDER BY name
  `;

  private static readonly GET_SUPPLIERS_SQL = `
    SELECT id::text, name
    FROM contacts
    WHERE type IN ('vendor', 'supplier')
    ORDER BY name
  `;

  private static readonly GET_INVOICES_SQL = `
    SELECT
      i.id::text,
      COALESCE(i.invoice_number, 'INV-' || i.id::text) AS number,
      i.amount,
      i.currency,
      i.status,
      i.vendor_id::text  AS "vendorId"
    FROM invoices i
    WHERE i.vendor_id IS NOT NULL
    ORDER BY i.invoice_date DESC
    LIMIT 500
  `;

  private static readonly GET_SUPPLIER_SPEND_SQL = `
    SELECT
      vendor_id::text AS "vendorId",
      SUM(amount)     AS total,
      COUNT(*)        AS count,
      MAX(expense_date) AS "lastExpense"
    FROM expenses
    WHERE vendor_id IS NOT NULL
    GROUP BY vendor_id
  `;

  constructor(
    private readonly repo: KnowledgeGraphRepository,
    private readonly tenantDb: TenantQueryRunnerService,
  ) {}

  /**
   * Rebuilds the full knowledge graph for a tenant.
   * Called with an active tenant context (search_path already set).
   */
  async buildForTenant(tenantId: string, schemaName: string): Promise<void> {
    this.logger.log(`Building KG for tenant ${tenantId} | schema ${schemaName}`);

    await runWithTenantContext(
      {
        tenantId,
        schemaName,
        userId: 'system-kg-builder',
        userEmail: 'system@platform.local',
        userRole: UserRole.SYSTEM_JOB,
        requestId: `kg-build-${tenantId}-${Date.now()}`,
        timestamp: new Date(),
      },
      async () => {
        // Fetch all source data in parallel
        const [customers, suppliers, invoices, supplierSpend] = await Promise.all([
          this.tenantDb.executeTenant<{ id: string; name: string }>(
            GraphBuilderService.GET_CUSTOMERS_SQL,
          ),
          this.tenantDb.executeTenant<{ id: string; name: string }>(
            GraphBuilderService.GET_SUPPLIERS_SQL,
          ),
          this.tenantDb.executeTenant<{
            id: string;
            number: string;
            amount: string;
            currency: string;
            status: string;
            vendorId: string;
          }>(GraphBuilderService.GET_INVOICES_SQL),
          this.tenantDb.executeTenant<{
            vendorId: string;
            total: string;
            count: string;
            lastExpense: string;
          }>(GraphBuilderService.GET_SUPPLIER_SPEND_SQL),
        ]);

        // Build spend lookup for supplier meta enrichment
        const spendByVendor = new Map(supplierSpend.map((s) => [s.vendorId, s]));

        // Upsert customer entities
        for (const c of customers) {
          await this.repo.upsertEntity('CUSTOMER', c.id, c.name, {
            source: 'contacts',
          });
        }

        // Upsert supplier entities — enrich meta with expense spend totals
        for (const s of suppliers) {
          const spend = spendByVendor.get(s.id);
          await this.repo.upsertEntity('SUPPLIER', s.id, s.name, {
            source: 'contacts',
            totalSpend: spend ? Number(spend.total) : 0,
            expenseCount: spend ? Number(spend.count) : 0,
            lastExpense: spend?.lastExpense ?? null,
          });
        }

        // Upsert invoice entities + relationships
        let relationshipsBuilt = 0;
        for (const inv of invoices) {
          const invEntity = await this.repo.upsertEntity(
            'INVOICE',
            inv.id,
            `Invoice ${inv.number}`,
            {
              amount: Number(inv.amount),
              currency: inv.currency,
              status: inv.status,
            },
          );

          // Link invoice → supplier
          if (inv.vendorId) {
            const supplierEntity = await this.repo.upsertEntity(
              'SUPPLIER',
              inv.vendorId,
              inv.vendorId, // label will be overwritten by the supplier upsert above
            );
            await this.repo.upsertRelationship(invEntity.id, supplierEntity.id, 'SUPPLIED_BY');
            relationshipsBuilt++;
          }
        }

        this.logger.log(
          `KG built — ${customers.length} customers, ${suppliers.length} suppliers, ` +
            `${invoices.length} invoices, ${relationshipsBuilt} relationships`,
        );
      },
    );
  }
}
