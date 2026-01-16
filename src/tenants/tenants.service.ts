import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Tenant } from './entities/tenant.entity';
import { CreateTenantDto, UpdateTenantDto } from './dto/create-tenant.dto';
import { TenantConnectionService } from '../database/tenant-connection.service';

/**
 * Tenants Service
 *
 * Business logic for tenant management:
 * - Create tenants (record + schema)
 * - Update tenant information
 * - Delete tenants (soft delete)
 * - Query tenants
 *
 * Code Complete Principle: Service contains business logic, not controllers
 */

@Injectable()
export class TenantsService {
  constructor(
    @InjectRepository(Tenant)
    private readonly tenantsRepository: Repository<Tenant>,
    private readonly tenantConnection: TenantConnectionService,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Create a new tenant atomically
   *
   * ATOMIC TRANSACTION: create tenant record → generate schema → run migrations → commit
   * If any step fails, complete rollback occurs.
   *
   * @param dto - Tenant creation data
   * @returns Created tenant
   */
  async create(dto: CreateTenantDto): Promise<Tenant> {
    const queryRunner = this.dataSource.createQueryRunner();

    try {
      await queryRunner.connect();
      await queryRunner.startTransaction();

      console.log(`🚀 Starting atomic tenant creation: ${dto.companyName}`);

      // Step 1: Create tenant record in transaction
      const tenant = this.tenantsRepository.create({
        companyName: dto.companyName,
        dataSourceType: dto.dataSourceType,
        subscriptionPlan: dto.subscriptionPlan,
        schemaName: '', // Will be set after UUID generation
        status: 'active',
        planLimits: this.getDefaultPlanLimits(dto.subscriptionPlan),
      });

      // Save within transaction to get UUID
      const savedTenant = await queryRunner.manager.save(Tenant, tenant);

      // Generate schema name from UUID
      savedTenant.schemaName = `tenant_${savedTenant.id.replace(/-/g, '')}`;

      // Update schema name within transaction
      await queryRunner.manager.save(Tenant, savedTenant);

      // Step 2: Create tenant schema within transaction
      await this.createSchemaTransactional(queryRunner, savedTenant.id);

      // Step 3: Run migrations on tenant schema (if any)
      // Future: Add tenant-specific migrations here

      // Step 4: Commit transaction
      await queryRunner.commitTransaction();

      console.log(`✅ Tenant created atomically: ${savedTenant.id} (${savedTenant.companyName})`);
      return savedTenant;
    } catch (error) {
      // Rollback on any error
      await queryRunner.rollbackTransaction();
      console.error(`❌ Tenant creation failed, rolled back: ${error.message}`, error.stack);
      throw new BadRequestException(`Failed to create tenant: ${error.message}`);
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Find tenant by ID
   *
   * @param id - Tenant UUID
   * @returns Tenant or throws NotFoundException
   */
  async findById(id: string): Promise<Tenant> {
    const tenant = await this.tenantsRepository.findOne({
      where: { id },
    });

    if (!tenant) {
      throw new NotFoundException(`Tenant with ID ${id} not found`);
    }

    return tenant;
  }

  /**
   * Find all tenants
   *
   * @param includeDeleted - Include soft-deleted tenants
   * @returns Array of tenants
   */
  async findAll(includeDeleted = false): Promise<Tenant[]> {
    const queryBuilder = this.tenantsRepository.createQueryBuilder('tenant');

    if (!includeDeleted) {
      queryBuilder.where('tenant.deleted_at IS NULL');
    }

    return queryBuilder.orderBy('tenant.created_at', 'DESC').getMany();
  }

  /**
   * Find tenants by status
   *
   * @param status - Tenant status
   * @returns Array of tenants
   */
  async findByStatus(status: 'active' | 'suspended' | 'cancelled'): Promise<Tenant[]> {
    return this.tenantsRepository.find({
      where: { status },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Update tenant information
   *
   * @param id - Tenant UUID
   * @param dto - Update data
   * @returns Updated tenant
   */
  async update(id: string, dto: UpdateTenantDto): Promise<Tenant> {
    const tenant = await this.findById(id);

    // Update fields
    if (dto.companyName) {
      tenant.companyName = dto.companyName;
    }

    if (dto.subscriptionPlan) {
      tenant.subscriptionPlan = dto.subscriptionPlan;
      tenant.planLimits = this.getDefaultPlanLimits(dto.subscriptionPlan);
    }

    if (dto.status) {
      tenant.status = dto.status;
    }

    return this.tenantsRepository.save(tenant);
  }

  /**
   * Soft delete a tenant
   *
   * Sets deleted_at timestamp. Tenant and schema remain in database.
   * For complete removal, use permanentDelete().
   *
   * @param id - Tenant UUID
   */
  async softDelete(id: string): Promise<void> {
    const tenant = await this.findById(id);
    await this.tenantsRepository.softDelete(id);
    console.log(`✅ Tenant soft deleted: ${tenant.id} (${tenant.companyName})`);
  }

  /**
   * Permanently delete a tenant
   *
   * ⚠️ DANGER: This deletes the tenant record AND the entire schema!
   * All tenant data will be permanently lost!
   *
   * @param id - Tenant UUID
   */
  async permanentDelete(id: string): Promise<void> {
    const tenant = await this.findById(id);

    // Delete tenant schema first
    await this.deleteSchema(id);

    // Delete tenant record
    await this.tenantsRepository.delete(id);

    console.log(`✅ Tenant permanently deleted: ${tenant.id} (${tenant.companyName})`);
  }

  /**
   * Create tenant schema
   *
   * Creates a new PostgreSQL schema with all tables for this tenant.
   * Called automatically during tenant creation.
   *
   * @param tenantId - Tenant UUID
   */
  async createSchema(tenantId: string): Promise<void> {
    const tenant = await this.findById(tenantId);

    await this.tenantConnection.createTenantSchema(tenantId);

    console.log(`✅ Schema created for tenant: ${tenant.id} (${tenant.schemaName})`);
  }

  /**
   * Create tenant schema within a transaction
   *
   * Used during atomic tenant creation to ensure schema creation
   * is part of the same transaction as tenant record creation.
   *
   * @param queryRunner - Transactional QueryRunner
   * @param tenantId - Tenant UUID
   */
  private async createSchemaTransactional(queryRunner: any, tenantId: string): Promise<void> {
    await this.tenantConnection.createTenantSchemaTransactional(queryRunner, tenantId);
  }

  /**
   * Delete tenant schema
   *
   * ⚠️ DANGER: Permanently deletes all tenant data!
   *
   * @param tenantId - Tenant UUID
   */
  async deleteSchema(tenantId: string): Promise<void> {
    const tenant = await this.findById(tenantId);

    await this.tenantConnection.deleteTenantSchema(tenantId);

    console.log(`✅ Schema deleted for tenant: ${tenant.id} (${tenant.schemaName})`);
  }

  /**
   * Verify tenant schema integrity
   *
   * Checks if all expected tables exist in the tenant schema.
   *
   * @param tenantId - Tenant UUID
   * @returns Verification result
   */
  async verifySchema(tenantId: string): Promise<{
    isValid: boolean;
    expectedTables: string[];
    actualTables: string[];
    missingTables: string[];
  }> {
    await this.findById(tenantId); // Verify tenant exists
    return this.tenantConnection.verifyTenantSchema(tenantId);
  }

  /**
   * Get tenant statistics
   *
   * @param tenantId - Tenant UUID
   * @returns Statistics (table counts, etc.)
   */
  async getStatistics(tenantId: string): Promise<{
    tenant: Tenant;
    tables: string[];
    tableCounts: Record<string, number>;
  }> {
    const tenant = await this.findById(tenantId);
    const tables = await this.tenantConnection.getTenantTables(tenantId);
    const tableCounts = await this.tenantConnection.getTenantTableCounts(tenantId);

    return {
      tenant,
      tables,
      tableCounts,
    };
  }

  /**
   * Get default plan limits based on subscription plan
   *
   * @param plan - Subscription plan
   * @returns Plan limits object
   */
  private getDefaultPlanLimits(plan: 'basic' | 'standard' | 'enterprise'): {
    max_users: number;
    max_storage_mb: number;
    max_connectors: number;
    max_api_calls_per_month: number;
    features: string[];
  } {
    const limits = {
      basic: {
        max_users: 3,
        max_storage_mb: 500,
        max_connectors: 1,
        max_api_calls_per_month: 5000,
        features: ['finance_dashboard', 'csv_upload', 'basic_ai'],
      },
      standard: {
        max_users: 10,
        max_storage_mb: 2000,
        max_connectors: 3,
        max_api_calls_per_month: 20000,
        features: ['finance_dashboard', 'csv_upload', 'advanced_ai', 'webhooks'],
      },
      enterprise: {
        max_users: -1, // unlimited
        max_storage_mb: 10000,
        max_connectors: -1, // unlimited
        max_api_calls_per_month: -1, // unlimited
        features: ['all'],
      },
    };

    return limits[plan];
  }

  /**
   * Count total tenants by status
   *
   * @returns Object with counts per status
   */
  async countByStatus(): Promise<{
    active: number;
    suspended: number;
    cancelled: number;
    total: number;
  }> {
    const [active, suspended, cancelled] = await Promise.all([
      this.tenantsRepository.count({ where: { status: 'active' } }),
      this.tenantsRepository.count({ where: { status: 'suspended' } }),
      this.tenantsRepository.count({ where: { status: 'cancelled' } }),
    ]);

    return {
      active,
      suspended,
      cancelled,
      total: active + suspended + cancelled,
    };
  }
}
