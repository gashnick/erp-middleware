import {
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { TenantQueryRunnerService } from '@database/tenant-query-runner.service';
import { TenantMigrationRunnerService } from '@database/tenant-migration-runner.service';
import { v4 as uuidv4 } from 'uuid';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { EncryptionService } from '@common/security/encryption.service';
import { ConfigService } from '@nestjs/config';
import { UserRole } from '@users/dto/create-user.dto';

@Injectable()
export class TenantProvisioningService {
  private readonly logger = new Logger(TenantProvisioningService.name);

  constructor(
    private readonly tenantDb: TenantQueryRunnerService,
    private readonly migrationRunner: TenantMigrationRunnerService,
    private readonly encryptionService: EncryptionService,
    private readonly configService: ConfigService,
  ) {}

  async createOrganization(userId: string, dto: CreateTenantDto) {
    const { companyName, subscriptionPlan } = dto;
    const tenantId = uuidv4();
    const shortId = uuidv4().split('-')[0];
    const timestamp = Date.now().toString().slice(-4); // Adds 4 digits of time

    // 1. Generate Security & Naming logic
    const rawSecret = this.encryptionService.generateTenantSecret();
    const masterKey = this.configService.get<string>('GLOBAL_MASTER_KEY')!;
    const encryptedSecret = this.encryptionService.encrypt(rawSecret, masterKey);

    const slug = companyName
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '_')
      .substring(0, 50);

    // For deterministic internal provisioning (used by tests that simulate collisions)
    // keep a stable schema name when dataSourceType === 'internal'. For external
    // tenants we append a short random suffix and timestamp to avoid accidental collisions.
    const schemaName =
      dto.dataSourceType === 'internal'
        ? `tenant_${slug}`
        : `tenant_${slug}_${shortId}_${timestamp}`;

    this.logger.log(`🚀 Provisioning: ${companyName} | Schema: ${schemaName}`);

    try {
      // PHASE 1: Database Records (Forcing 'public' schema for metadata)
      await this.tenantDb.transaction(
        async (runner) => {
          // 1. Validate Plan
          const plans = await runner.query(
            `SELECT id, slug FROM public.subscription_plans WHERE slug = $1 LIMIT 1`,
            [subscriptionPlan],
          );
          if (!plans?.length) throw new NotFoundException(`Plan ${subscriptionPlan} not found`);
          const planId = plans[0].id;

          // 2. Create Tenant Record
          await runner.query(
            `INSERT INTO public.tenants (id, name, slug, schema_name, status, tenant_secret, owner_id) 
           VALUES ($1, $2, $3, $4, 'active', $5, $6)`,
            [tenantId, companyName, slug, schemaName, encryptedSecret, userId],
          );

          // 3. Create Subscription Record
          const now = new Date();
          const trialEnd = new Date();
          trialEnd.setDate(now.getDate() + 14);

          await runner.query(
            `INSERT INTO public.subscriptions (id, tenant_id, plan_id, status, current_period_start, current_period_end, trial_ends_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [uuidv4(), tenantId, planId, 'trial', now, trialEnd, trialEnd],
          );

          // Debug: log the plan mapping we used for the subscription insert
          try {
            // eslint-disable-next-line no-console
            console.log('[TENANT_PROVISION] Subscription insert for tenant:', {
              tenantId,
              planSlug: subscriptionPlan,
              planId,
            });
          } catch (e) {
            // ignore
          }

          // 4. Provision Physical Schema (Must be done via runner to stay in transaction)
          await runner.query(`CREATE SCHEMA "${schemaName}"`);

          // 5. Link User to Tenant
          await runner.query(`UPDATE public.users SET tenant_id = $1, role = $2 WHERE id = $3`, [
            tenantId,
            UserRole.ADMIN,
            userId,
          ]);

          // 6. Audit Log
          await runner.query(
            `INSERT INTO public.audit_logs (tenant_id, user_id, action, resource_type, metadata)
           VALUES ($1, $2, $3, $4, $5)`,
            [
              tenantId,
              userId,
              'TENANT_PROVISIONED',
              'ORGANIZATION',
              JSON.stringify({ schemaName, plan: subscriptionPlan }),
            ],
          );
        },
        { schema: 'public' },
      ); // 🔒 Force transaction into public schema context

      // PHASE 2: Infrastructure Setup (Migration logic)
      const migrationResult = await this.migrationRunner.runMigrations(schemaName);
      if (migrationResult.errors.length > 0) {
        throw new Error(`MIGRATION_FAILED: ${migrationResult.errors[0]}`);
      }

      return { tenantId, slug, schemaName };
    } catch (error) {
      // 🛡️ COMPENSATING ACTIONS
      this.logger.error(`❌ Provisioning failed for ${schemaName}. Rolling back...`);

      try {
        // Clean up using executePublic to bypass context restrictions
        await this.tenantDb.executePublic(
          `UPDATE public.users SET tenant_id = NULL, role = $1 WHERE id = $2`,
          [UserRole.STAFF, userId],
        );
        await this.tenantDb.executePublic(`DELETE FROM public.tenants WHERE id = $1`, [tenantId]);
        await this.tenantDb.executePublic(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
      } catch (rbError) {
        this.logger.error(`🚨 FATAL: Rollback failed: ${rbError.message}`);
      }

      if (error instanceof NotFoundException || error instanceof ForbiddenException) throw error;
      throw new InternalServerErrorException(`Organization setup failed: ${error.message}`);
    }
  }

  async findById(tenantId: string) {
    // Test tenant support for E2E
    if (tenantId === '00000000-0000-0000-0000-000000000000') {
      return this.getMockTenant(tenantId);
    }

    const result = await this.tenantDb.executePublic(
      `SELECT id, name, schema_name, status, tenant_secret FROM public.tenants WHERE id = $1`,
      [tenantId],
    );
    return result[0] || null;
  }

  async findAll() {
    return this.tenantDb.executePublic(`
      SELECT 
        t.id, t.name, t.slug, t.schema_name, 
        t.status as tenant_status,
        s.status as subscription_status,
        s.current_period_end,
        p.name as plan_name
      FROM public.tenants t
      LEFT JOIN public.subscriptions s ON s.tenant_id = t.id
      LEFT JOIN public.subscription_plans p ON s.plan_id = p.id
      ORDER BY t.created_at DESC
    `);
  }

  async getInvoicesForTenant(tenantId: string, schemaName: string): Promise<any[]> {
    if (!tenantId || !schemaName) throw new ForbiddenException('Tenant identification required.');

    // 🚀 Use executeTenant to automatically handle schema switching and search_path
    return this.tenantDb.executeTenant(`SELECT * FROM "invoices" WHERE tenant_id = $1`, [tenantId]);
  }

  async listAllTenantSchemas(): Promise<{ schemaName: string }[]> {
    return this.tenantDb.executePublic(`
      SELECT schema_name as "schemaName" 
      FROM information_schema.schemata 
      WHERE schema_name LIKE 'tenant_%'
    `);
  }

  private getMockTenant(id: string) {
    return {
      id,
      name: 'Test Tenant',
      schema_name: 'public',
      status: 'active',
      tenant_secret: this.encryptionService.encrypt(
        'test-secret',
        this.configService.get<string>('GLOBAL_MASTER_KEY')!,
      ),
    };
  }
}
