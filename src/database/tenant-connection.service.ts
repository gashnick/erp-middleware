// // src/database/tenant-connection.service.ts
// import { Injectable } from '@nestjs/common';
// import { DataSource } from 'typeorm';
// import { TenantSchemaTemplate } from './tenant-schema-template';

// @Injectable()
// export class TenantConnectionService {
//   constructor(private readonly dataSource: DataSource) {}

//   async createTenantSchema(tenantId: string): Promise<void> {
//     const schemaName = `tenant_${tenantId}`;
//     const queryRunner = this.dataSource.createQueryRunner();

//     try {
//       await queryRunner.connect();

//       // Use the template to create schema
//       const template = new TenantSchemaTemplate();
//       await template.createSchema(queryRunner, schemaName);
//     } finally {
//       await queryRunner.release();
//     }
//   }

//   async getConnection(tenantId: string): Promise<DataSource> {
//     const schemaName = `tenant_${tenantId}`;

//     // Create a connection with the tenant schema set
//     const dataSource = new DataSource({
//       ...this.dataSource.options,
//       schema: schemaName,
//     });

//     await dataSource.initialize();
//     return dataSource;
//   }
// }
import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, QueryRunner } from 'typeorm';
import { TenantSchemaTemplate } from './tenant-schema-template';

/**
 * Tenant Connection Service
 *
 * THIS IS THE HEART OF MULTI-TENANCY!
 *
 * Responsibilities:
 * - Create tenant schemas dynamically
 * - Switch database context to tenant schema
 * - Provide tenant-scoped database connections
 * - Manage tenant schema lifecycle
 *
 * Code Complete Principle: Single Responsibility - manages ONLY tenant database operations
 */

@Injectable()
export class TenantConnectionService {
  // Cache of tenant connections (optional optimization)
  private tenantConnections: Map<string, DataSource> = new Map();

  constructor(
    @InjectDataSource()
    private readonly masterDataSource: DataSource,
  ) {}

  /**
   * Create a new tenant schema with all tables
   *
   * Called when a new tenant registers.
   * Creates: tenant_<uuid> schema with invoices, payments, expenses, etc.
   *
   * @param tenantId - UUID of the tenant
   * @throws BadRequestException if schema already exists
   */
  async createTenantSchema(tenantId: string): Promise<void> {
    const schemaName = this.getSchemaName(tenantId);

    // Check if schema already exists
    const exists = await this.schemaExists(schemaName);
    if (exists) {
      throw new BadRequestException(`Tenant schema '${schemaName}' already exists`);
    }

    console.log(`Creating tenant schema: ${schemaName}`);

    const queryRunner = this.masterDataSource.createQueryRunner();

    try {
      await queryRunner.connect();
      await queryRunner.startTransaction();

      // Use the template to create schema
      const template = new TenantSchemaTemplate();
      await template.createSchema(queryRunner, schemaName);

      await queryRunner.commitTransaction();
      console.log(`✅ Tenant schema '${schemaName}' created successfully`);
    } catch (error) {
      await queryRunner.rollbackTransaction();
      console.error(`❌ Failed to create tenant schema '${schemaName}':`, error);
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Delete a tenant schema and all its data
   *
   * ⚠️ DANGEROUS: This permanently deletes all tenant data!
   * Should only be called after proper authorization and backup.
   *
   * @param tenantId - UUID of the tenant
   */
  async deleteTenantSchema(tenantId: string): Promise<void> {
    const schemaName = this.getSchemaName(tenantId);

    console.log(`Deleting tenant schema: ${schemaName}`);

    const queryRunner = this.masterDataSource.createQueryRunner();

    try {
      await queryRunner.connect();

      // Use template to drop schema
      const template = new TenantSchemaTemplate();
      await template.dropSchema(queryRunner, schemaName);

      // Remove from cache if present
      if (this.tenantConnections.has(tenantId)) {
        const connection = this.tenantConnections.get(tenantId);
        if (connection) {
          await connection.destroy();
        }
        this.tenantConnections.delete(tenantId);
      }

      console.log(`✅ Tenant schema '${schemaName}' deleted successfully`);
    } catch (error) {
      console.error(`❌ Failed to delete tenant schema '${schemaName}':`, error);
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Get a QueryRunner with search_path set to tenant schema
   *
   * This is the KEY METHOD for tenant-scoped queries.
   * Use this when you need to run queries on a specific tenant's data.
   *
   * @param tenantId - UUID of the tenant
   * @returns QueryRunner configured for tenant schema
   *
   * @example
   * const queryRunner = await this.tenantConnection.getQueryRunner(tenantId);
   * try {
   *   await queryRunner.connect();
   *   const invoices = await queryRunner.query('SELECT * FROM invoices');
   * } finally {
   *   await queryRunner.release();
   * }
   */
  async getQueryRunner(tenantId: string): Promise<QueryRunner> {
    const schemaName = this.getSchemaName(tenantId);

    // Verify schema exists
    const exists = await this.schemaExists(schemaName);
    if (!exists) {
      throw new BadRequestException(`Tenant schema '${schemaName}' does not exist`);
    }

    const queryRunner = this.masterDataSource.createQueryRunner();
    await queryRunner.connect();

    // Set search_path to tenant schema
    await queryRunner.query(`SET search_path TO ${schemaName}`);

    return queryRunner;
  }

  /**
   * Execute a query on a tenant's schema
   *
   * Convenience method that handles QueryRunner lifecycle.
   *
   * @param tenantId - UUID of the tenant
   * @param query - SQL query to execute
   * @param parameters - Query parameters
   * @returns Query results
   *
   * @example
   * const invoices = await this.tenantConnection.executeQuery(
   *   tenantId,
   *   'SELECT * FROM invoices WHERE status = $1',
   *   ['paid']
   * );
   */
  async executeQuery<T = any>(tenantId: string, query: string, parameters?: any[]): Promise<T[]> {
    const queryRunner = await this.getQueryRunner(tenantId);

    try {
      return await queryRunner.query(query, parameters);
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Get schema name from tenant ID
   *
   * @param tenantId - UUID of the tenant
   * @returns Schema name (e.g., 'tenant_abc123...')
   */
  private getSchemaName(tenantId: string): string {
    // Remove hyphens from UUID for cleaner schema name
    const cleanId = tenantId.replace(/-/g, '');
    return `tenant_${cleanId}`;
  }

  /**
   * Check if a tenant schema exists
   *
   * @param schemaName - Schema name to check
   * @returns true if schema exists
   */
  private async schemaExists(schemaName: string): Promise<boolean> {
    const result = await this.masterDataSource.query(
      `SELECT EXISTS(
        SELECT 1 FROM information_schema.schemata 
        WHERE schema_name = $1
      ) as exists`,
      [schemaName],
    );

    return result[0].exists;
  }

  /**
   * Get all tables in a tenant schema
   *
   * Useful for debugging and verification
   *
   * @param tenantId - UUID of the tenant
   * @returns Array of table names
   */
  async getTenantTables(tenantId: string): Promise<string[]> {
    const schemaName = this.getSchemaName(tenantId);

    const result = await this.masterDataSource.query<{ tablename: string }[]>(
      `SELECT tablename 
       FROM pg_tables 
       WHERE schemaname = $1
       ORDER BY tablename`,
      [schemaName],
    );

    return result.map((row) => row.tablename);
  }

  /**
   * Get row counts for all tables in a tenant schema
   *
   * Useful for monitoring and debugging
   *
   * @param tenantId - UUID of the tenant
   * @returns Object with table names as keys and row counts as values
   */
  async getTenantTableCounts(tenantId: string): Promise<Record<string, number>> {
    const tables = await this.getTenantTables(tenantId);
    const counts: Record<string, number> = {};

    for (const table of tables) {
      const result = await this.executeQuery<{ count: string }>(
        tenantId,
        `SELECT COUNT(*) as count FROM ${table}`,
      );
      counts[table] = parseInt(result[0].count, 10);
    }

    return counts;
  }

  /**
   * Verify tenant schema integrity
   *
   * Checks if all expected tables exist in the tenant schema
   *
   * @param tenantId - UUID of the tenant
   * @returns Object with verification results
   */
  async verifyTenantSchema(tenantId: string): Promise<{
    isValid: boolean;
    expectedTables: string[];
    actualTables: string[];
    missingTables: string[];
  }> {
    const expectedTables = ['invoices', 'payments', 'expenses', 'ai_insights', 'upload_batches'];

    const actualTables = await this.getTenantTables(tenantId);
    const missingTables = expectedTables.filter((table) => !actualTables.includes(table));

    return {
      isValid: missingTables.length === 0,
      expectedTables,
      actualTables,
      missingTables,
    };
  }

  /**
   * Clean up all cached connections
   *
   * Call this on application shutdown
   */
  async cleanup(): Promise<void> {
    for (const [tenantId, connection] of this.tenantConnections.entries()) {
      try {
        await connection.destroy();
        console.log(`✅ Closed connection for tenant: ${tenantId}`);
      } catch (error) {
        console.error(`❌ Error closing connection for tenant ${tenantId}:`, error);
      }
    }
    this.tenantConnections.clear();
  }
}
