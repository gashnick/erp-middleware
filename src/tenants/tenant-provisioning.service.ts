import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { TenantQueryRunnerService } from '@database/tenant-query-runner.service';
import { TenantMigrationRunnerService } from '@database/tenant-migration-runner.service';
import { v4 as uuidv4 } from 'uuid';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { randomBytes } from 'crypto';
import { EncryptionService } from '@common/security/encryption.service';

@Injectable()
export class TenantProvisioningService {
  private readonly logger = new Logger(TenantProvisioningService.name);

  constructor(
    private readonly tenantDb: TenantQueryRunnerService,
    private readonly migrationRunner: TenantMigrationRunnerService,
    private readonly encryptionService: EncryptionService,
  ) {}

  async createOrganization(userId: string, dto: CreateTenantDto) {
    const { companyName, subscriptionPlan } = dto;
    const tenantId = uuidv4();

    // 2. Generate the "Data Encryption Key" (DEK) for this tenant
    const rawSecret = this.encryptionService.generateTenantSecret();

    // 3. Envelope Encryption: Encrypt the secret using our Master Key
    // This assumes your EncryptionService has a method to use the GLOBAL_MASTER_KEY
    const encryptedSecret = this.encryptionService.encrypt(
      rawSecret,
      process.env.GLOBAL_MASTER_KEY || 'default_master_key',
    );

    const slug = companyName
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '_')
      .substring(0, 50);
    const schemaName = `tenant_${slug}_${tenantId.split('-')[0]}`;

    // STEP 1: Create Schema and Metadata (Commit this first)
    await this.tenantDb.transaction(async (runner) => {
      // 1. Fetch Plan
      const plans = await runner.query(
        `SELECT id, trial_days FROM public.subscription_plans WHERE slug = $1 LIMIT 1`,
        [subscriptionPlan],
      );
      if (!plans?.length) throw new NotFoundException(`Plan ${subscriptionPlan} not found`);

      // 2. Create Tenant & Subscription (Added tenant_secret here)
      await runner.query(
        `INSERT INTO public.tenants (id, name, slug, schema_name, status, tenant_secret, owner_id) 
         VALUES ($1, $2, $3, $4, 'active', $5, $6)`,
        [tenantId, companyName, slug, schemaName, encryptedSecret, userId],
      );

      // 3. Create Physical Schema
      await runner.query(`CREATE SCHEMA "${schemaName}"`);

      // 4. Update User Role
      await runner.query(`UPDATE public.users SET tenant_id = $1, role = 'ADMIN' WHERE id = $2`, [
        tenantId,
        userId,
      ]);
    });

    // STEP 2: Run Migrations
    try {
      this.logger.log(`Starting migrations for new schema: ${schemaName}`);
      const migrationResult = await this.migrationRunner.runMigrations(schemaName);

      if (migrationResult.errors.length > 0) {
        throw new Error(`Migration errors: ${migrationResult.errors.join(', ')}`);
      }
    } catch (error) {
      this.logger.error(`Migration phase failed: ${error.message}`);
      throw new InternalServerErrorException('Environment provisioned but table setup failed');
    }

    return { tenantId, schemaName, slug, plan: subscriptionPlan };
  }

  async findById(tenantId: string) {
    const runner = await this.tenantDb.getRunner();
    try {
      const result = await runner.query(
        `SELECT id, name, schema_name, status, tenant_secret
         FROM public.tenants 
         WHERE id = $1`,
        [tenantId],
      );
      // Return the first tenant found or null
      return result && result.length > 0 ? result[0] : null;
    } finally {
      await runner.release();
    }
  }

  async findAll() {
    const runner = await this.tenantDb.getRunner();
    try {
      const result = await runner.query(`
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
      return result;
    } catch (error) {
      this.logger.error(`Failed to fetch all tenants: ${error.message}`);
      throw new InternalServerErrorException('Could not retrieve tenants list');
    } finally {
      await runner.release();
    }
  }
}
