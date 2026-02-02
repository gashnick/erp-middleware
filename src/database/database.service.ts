import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ConfigService } from '../config/config.service';
import { runWithTenantContext, UserRole } from '../common/context/tenant-context';

/**
 * Database Service
 *
 * Provides utilities for database operations:
 * - Health checks
 * - Query execution
 * - Transaction management
 *
 * Code Complete Principle: Encapsulate database utilities in one service
 */

@Injectable()
export class DatabaseService implements OnModuleInit {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly config: ConfigService,
  ) {}

  /**
   * Initialize database connection on module startup
   */
  async onModuleInit() {
    await this.checkConnection();
  }

  /**
   * Check if database connection is healthy
   * @returns true if connected, false otherwise
   */
  async checkConnection(): Promise<boolean> {
    try {
      // Health check queries should bypass RLS using system context
      await runWithTenantContext(
        {
          tenantId: 'system-health-check',
          userId: 'health-check',
          userRole: UserRole.SYSTEM_READONLY,
        },
        async () => {
          await this.dataSource.query('SELECT 1');
        },
      );
      console.log('✅ Database connection healthy');
      return true;
    } catch (error) {
      console.error('❌ Database connection failed:', error.message);
      return false;
    }
  }

  /**
   * Get the master DataSource (public schema)
   * Use this for queries on master tables (tenants, users, etc.)
   */
  getMasterDataSource(): DataSource {
    return this.dataSource;
  }

  /**
   * Execute a raw SQL query on master schema
   * @param query - SQL query string
   * @param parameters - Query parameters
   */
  async executeQuery<T = any>(query: string, parameters?: any[]): Promise<T[]> {
    return this.dataSource.query(query, parameters);
  }

  /**
   * Get database statistics
   * Useful for monitoring and debugging
   */
  async getDatabaseStats(): Promise<{
    isConnected: boolean;
    database: string;
    host: string;
    port: number;
    totalTenants: number;
    totalUsers: number;
  }> {
    const isConnected = await this.checkConnection();

    if (!isConnected) {
      return {
        isConnected: false,
        database: this.config.databaseName,
        host: this.config.databaseHost,
        port: this.config.databasePort,
        totalTenants: 0,
        totalUsers: 0,
      };
    }

    // Count tenants
    const tenantsResult = await this.executeQuery(
      'SELECT COUNT(*) as count FROM public.tenants WHERE deleted_at IS NULL',
    );
    const totalTenants = parseInt(tenantsResult[0].count, 10);

    // Count users
    const usersResult = await this.executeQuery(
      'SELECT COUNT(*) as count FROM public.users WHERE deleted_at IS NULL',
    );
    const totalUsers = parseInt(usersResult[0].count, 10);

    return {
      isConnected: true,
      database: this.config.databaseName,
      host: this.config.databaseHost,
      port: this.config.databasePort,
      totalTenants,
      totalUsers,
    };
  }

  /**
   * List all tenant schemas in the database
   * Useful for admin/monitoring
   */
  async listTenantSchemas(): Promise<string[]> {
    const result = await this.executeQuery<{ schema_name: string }>(
      `SELECT schema_name 
       FROM information_schema.schemata 
       WHERE schema_name LIKE 'tenant_%'
       ORDER BY schema_name`,
    );

    return result.map((row) => row.schema_name);
  }

  /**
   * Check if a specific schema exists
   * @param schemaName - Schema name to check
   */
  async schemaExists(schemaName: string): Promise<boolean> {
    const result = await this.executeQuery<{ exists: boolean }>(
      `SELECT EXISTS(
        SELECT 1 FROM information_schema.schemata 
        WHERE schema_name = $1
      ) as exists`,
      [schemaName],
    );

    return result[0].exists;
  }

  /**
   * Get connection pool statistics
   * Useful for monitoring connection usage
   */
  getPoolStats(): {
    maxConnections: number;
    activeConnections: number;
    idleConnections: number;
  } {
    // TypeORM doesn't expose pool stats directly, so we return config
    return {
      maxConnections: this.config.databasePoolSize,
      activeConnections: 0, // Would need pg pool access
      idleConnections: 0, // Would need pg pool access
    };
  }

  /**
   * Health check endpoint data
   * Returns comprehensive database health information
   */
  async getHealthCheck(): Promise<{
    status: 'healthy' | 'unhealthy';
    database: string;
    connected: boolean;
    responseTime: number;
    tenantCount: number;
    userCount: number;
  }> {
    const startTime = Date.now();

    try {
      const connected = await this.checkConnection();

      if (!connected) {
        return {
          status: 'unhealthy',
          database: this.config.databaseName,
          connected: false,
          responseTime: Date.now() - startTime,
          tenantCount: 0,
          userCount: 0,
        };
      }

      const stats = await this.getDatabaseStats();

      return {
        status: 'healthy',
        database: this.config.databaseName,
        connected: true,
        responseTime: Date.now() - startTime,
        tenantCount: stats.totalTenants,
        userCount: stats.totalUsers,
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        database: this.config.databaseName,
        connected: false,
        responseTime: Date.now() - startTime,
        tenantCount: 0,
        userCount: 0,
      };
    }
  }
}
