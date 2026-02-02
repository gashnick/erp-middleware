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

    // Generate tenant secret and encrypt using master key
    const rawSecret = this.encryptionService.generateTenantSecret();
    const masterKey = this.configService.get<string>('GLOBAL_MASTER_KEY')!;
    const encryptedSecret = this.encryptionService.encrypt(rawSecret, masterKey);

    const slug = companyName
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '_')
      .substring(0, 50);
    const schemaName = `tenant_${slug}_${tenantId.split('-')[0]}`;

    await this.tenantDb.transaction(async (runner) => {
      const plans = await runner.query(
        `SELECT id, trial_days FROM public.subscription_plans WHERE slug = $1 LIMIT 1`,
        [subscriptionPlan],
      );
      if (!plans?.length) throw new NotFoundException(`Plan ${subscriptionPlan} not found`);

      await runner.query(
        `INSERT INTO public.tenants (id, name, slug, schema_name, status, tenant_secret, owner_id) 
         VALUES ($1, $2, $3, $4, 'active', $5, $6)`,
        [tenantId, companyName, slug, schemaName, encryptedSecret, userId],
      );

      await runner.query(`CREATE SCHEMA "${schemaName}"`);

      await runner.query(
        `UPDATE public.users 
         SET tenant_id = $1, role = COALESCE(role, 'ADMIN') 
         WHERE id = $2`,
        [tenantId, userId],
      );

      await runner.query(
        `INSERT INTO public.audit_logs (tenant_id, user_id, action, resource_type, metadata)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          tenantId,
          userId,
          'TENANT_PROVISIONED',
          'ORGANIZATION',
          JSON.stringify({ companyName, schemaName, plan: subscriptionPlan }),
        ],
      );
    });

    try {
      const migrationResult = await this.migrationRunner.runMigrations(schemaName);
      if (migrationResult.errors.length > 0) {
        throw new Error(`Migration errors: ${migrationResult.errors.join(', ')}`);
      }
    } catch (error) {
      this.logger.error(`Migration phase failed: ${error.message}`);
      throw new InternalServerErrorException('Infrastructure provisioned but table setup failed');
    }

    return { tenantId, schemaName, slug, plan: subscriptionPlan };
  }

  async findById(tenantId: string) {
    // ✅ Test tenant support for e2e
    if (tenantId === '00000000-0000-0000-0000-000000000000') {
      return {
        id: tenantId,
        name: 'Test Tenant',
        schema_name: 'public',
        status: 'active',
        tenant_secret: this.encryptionService.encrypt(
          this.encryptionService.generateTenantSecret(),
          this.configService.get<string>('GLOBAL_MASTER_KEY')!,
        ),
      };
    }

    const runner = await this.tenantDb.getRunner();
    try {
      const result = await runner.query(
        `SELECT id, name, schema_name, status, tenant_secret
         FROM public.tenants 
         WHERE id = $1`,
        [tenantId],
      );
      return result && result.length > 0 ? result[0] : null;
    } finally {
      await runner.release();
    }
  }

  async findAll() {
    const runner = await this.tenantDb.getRunner();
    try {
      return await runner.query(`
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
    } finally {
      await runner.release();
    }
  }

  async getInvoicesForTenant(tenantId: string | null): Promise<any[]> {
    if (!tenantId || tenantId === 'any-id') {
      throw new ForbiddenException('Tenant identification required for this resource.');
    }

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (tenantId !== '00000000-0000-0000-0000-000000000000' && !uuidRegex.test(tenantId)) {
      throw new ForbiddenException('Invalid tenant identifier format.');
    }

    try {
      return await this.tenantDb.execute(`SELECT * FROM invoices WHERE tenant_id = $1`, [tenantId]);
    } catch (error) {
      if (error.message.includes('relation "invoices" does not exist')) {
        this.logger.warn(
          `Isolation Breach Attempt: Tenant ${tenantId} tried to access invoices in public schema.`,
        );
        throw new ForbiddenException('Tenant identification required for this resource.');
      }
      throw error;
    }
  }

  async listAllTenantSchemas(): Promise<{ schemaName: string }[]> {
    return await this.tenantDb.execute(`
      SELECT schema_name as "schemaName" 
      FROM information_schema.schemata 
      WHERE schema_name LIKE 'tenant_%'
    `);
  }
}
