// src/tenants/tenant-provisioning.service.ts
import {
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { TenantQueryRunnerService } from '@database/tenant-query-runner.service';
import { TenantMigrationRunnerService } from '@database/tenant-migration-runner.service';
import { v4 as uuidv4 } from 'uuid';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { EncryptionService } from '@common/security/encryption.service';
import { UserRole } from '@users/dto/create-user.dto';

// ── Canonical prompt templates ────────────────────────────────────────────────
// IMPORTANT: {{kpiSummary}} and {{anomalySummary}} placeholders MUST be present.
// PromptTemplateService.getActive() auto-repairs missing placeholders, but seeding
// the correct template here prevents the repair from ever being needed on new tenants.
const DEFAULT_PROMPT_TEMPLATES = [
  {
    name: 'finance_chat',
    is_active: true,
    content: `You are a helpful financial assistant for an ERP system.
You have access to the following REAL financial data for this tenant. This data comes directly from their invoices, bank transactions, and expense records.

=== KPI SUMMARY ===
{{kpiSummary}}

=== RECENT ANOMALIES ===
{{anomalySummary}}

INSTRUCTIONS:
- Answer questions using ONLY the data shown above.
- Always cite specific figures when answering (e.g. "Based on your invoices, revenue in Nov 2025 was USD 96,800").
- Never say you lack access to financial data — the KPI Summary above IS your data source.
- If a specific metric is not present in the data above, say it is not available in the current dataset.
- If anomalies are listed, proactively flag them when relevant.
- Be concise and professional.`,
  },
];

@Injectable()
export class TenantProvisioningService {
  private readonly logger = new Logger(TenantProvisioningService.name);

  constructor(
    private readonly tenantDb: TenantQueryRunnerService,
    private readonly migrationRunner: TenantMigrationRunnerService,
    private readonly encryptionService: EncryptionService,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  /**
   * Orchestrates the creation of a new organization.
   */
  async createOrganization(userId: string, dto: CreateTenantDto) {
    const { companyName, subscriptionPlan } = dto;
    const tenantId = uuidv4();
    const shortId = uuidv4().split('-')[0];
    const timestamp = Date.now().toString().slice(-4);

    const rawSecret = this.encryptionService.generateTenantSecret();
    const encryptedSecret = this.encryptionService.encrypt(rawSecret);

    const slug = companyName
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '_')
      .substring(0, 50);

    const schemaName =
      dto.dataSourceType === 'internal'
        ? `tenant_${slug}`
        : `tenant_${slug}_${shortId}_${timestamp}`;

    this.logger.log(`🚀 Provisioning: ${companyName} | Schema: ${schemaName}`);

    try {
      const runner = this.dataSource.createQueryRunner();
      await runner.connect();
      await runner.startTransaction();

      try {
        // STEP 1: Validate Plan
        const plans = await runner.query(
          `SELECT id, trial_days FROM public.subscription_plans WHERE slug = $1 LIMIT 1`,
          [subscriptionPlan],
        );
        if (!plans?.length) {
          throw new NotFoundException(`Plan '${subscriptionPlan}' not found in registry.`);
        }

        const planId = plans[0].id;
        const trialDays = plans[0].trial_days ?? 0;

        // STEP 2: Create Tenant Metadata
        await runner.query(
          `INSERT INTO public.tenants (id, name, slug, schema_name, status, tenant_secret, owner_id)
           VALUES ($1, $2, $3, $4, 'active', $5, $6)`,
          [tenantId, companyName, slug, schemaName, encryptedSecret, userId],
        );

        // STEP 3: Create Subscription
        const now = new Date();
        const trialEnd = new Date();
        trialEnd.setDate(now.getDate() + trialDays);
        const periodEnd =
          trialDays > 0 ? trialEnd : new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

        await runner.query(
          `INSERT INTO public.subscriptions
            (id, tenant_id, plan_id, status, current_period_start, current_period_end, trial_ends_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            uuidv4(),
            tenantId,
            planId,
            trialDays > 0 ? 'trial' : 'active',
            now,
            periodEnd,
            trialDays > 0 ? trialEnd : null,
          ],
        );

        // STEP 4: Physical Schema Creation
        await runner.query(`CREATE SCHEMA "${schemaName}"`);

        // STEP 5: Assign User to Tenant
        await runner.query(`UPDATE public.users SET tenant_id = $1, role = $2 WHERE id = $3`, [
          tenantId,
          UserRole.ADMIN,
          userId,
        ]);

        await runner.commitTransaction();
      } catch (err) {
        await runner.rollbackTransaction();
        throw err;
      } finally {
        await runner.release();
      }

      // PHASE 2: Run tenant schema migrations (creates all tables inside schemaName)
      this.logger.log(`📦 Running migrations for schema: ${schemaName}`);
      const migrationResult = await this.migrationRunner.runMigrations(schemaName);
      if (migrationResult.errors.length > 0) {
        throw new Error(`MIGRATION_FAILED: ${migrationResult.errors[0]}`);
      }
      this.logger.log(
        `✅ Migrations complete: ${migrationResult.executed.length} executed, ${migrationResult.skipped.length} skipped`,
      );

      // PHASE 3: Seed default data into the new tenant schema
      await this.seedDefaultPromptTemplates(schemaName);

      return { tenantId, slug, schemaName };
    } catch (error) {
      this.logger.error(`❌ Provisioning failed for ${schemaName}. Rolling back.`);
      await this.performRollback(tenantId, schemaName, userId);
      throw error instanceof NotFoundException
        ? error
        : new InternalServerErrorException(error.message);
    }
  }

  async findById(tenantId: string) {
    if (tenantId === '00000000-0000-0000-0000-000000000000') return this.getMockTenant(tenantId);

    const result = await this.dataSource.query(
      `SELECT id, name, schema_name, status, tenant_secret FROM public.tenants WHERE id = $1`,
      [tenantId],
    );

    if (!result[0]) return null;
    const tenant = result[0];

    try {
      tenant.tenant_secret = this.encryptionService.decrypt(tenant.tenant_secret);
    } catch (err) {
      this.logger.error(`Failed to decrypt secret for tenant ${tenantId}: ${err.message}`);
      throw new InternalServerErrorException('Key mismatch or configuration error');
    }

    return tenant;
  }

  private async seedDefaultPromptTemplates(schemaName: string): Promise<void> {
    // NOTE: We cannot use executeTenant() here because seeding runs outside
    // a request context — there is no AsyncLocalStorage tenant context set.
    // Instead we use a raw query runner with explicit SET search_path.
    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    try {
      await runner.query(`SET search_path TO "${schemaName}", public`);
      for (const template of DEFAULT_PROMPT_TEMPLATES) {
        await runner.query(
          `INSERT INTO prompt_templates (name, content, is_active)
           VALUES ($1, $2, $3)
           ON CONFLICT (name) DO UPDATE SET content = EXCLUDED.content`,
          [template.name, template.content, template.is_active],
        );
        this.logger.log(`🌱 Seeded prompt template '${template.name}' for ${schemaName}`);
      }
    } catch (err) {
      this.logger.warn(`⚠️ Seed failed for ${schemaName}: ${err.message}`);
    } finally {
      try {
        await runner.query(`SET search_path TO public`);
      } catch (_) {}
      await runner.release();
    }
  }

  private async performRollback(tenantId: string, schemaName: string, userId: string) {
    try {
      await this.dataSource.query(
        `UPDATE public.users SET tenant_id = NULL, role = $1 WHERE id = $2`,
        [UserRole.STAFF, userId],
      );
      await this.dataSource.query(`DELETE FROM public.subscriptions WHERE tenant_id = $1`, [
        tenantId,
      ]);
      await this.dataSource.query(`DELETE FROM public.tenants WHERE id = $1`, [tenantId]);
      await this.dataSource.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    } catch (rbError) {
      this.logger.error(`🚨 CRITICAL: Rollback failed for ${tenantId}. ${rbError.message}`);
    }
  }

  async findAll() {
    return this.dataSource.query(`
      SELECT t.id, t.name, t.slug, t.schema_name, t.status as tenant_status,
             s.status as subscription_status, s.current_period_end, p.name as plan_name
      FROM public.tenants t
      LEFT JOIN public.subscriptions s ON s.tenant_id = t.id
      LEFT JOIN public.subscription_plans p ON s.plan_id = p.id
      ORDER BY t.created_at DESC`);
  }

  private getMockTenant(id: string) {
    return {
      id,
      name: 'Test Tenant',
      schema_name: 'public',
      status: 'active',
      tenant_secret: 'test-secret',
    };
  }
}
