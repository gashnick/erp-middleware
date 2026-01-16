// src/health/health.controller.ts
import { Controller, Get } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { TenantMigrationRunnerService } from '../database/tenant-migration-runner.service';

@Controller('health')
export class HealthController {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly tenantMigrations: TenantMigrationRunnerService,
  ) {}

  @Get()
  async check() {
    const dbHealth = await this.databaseService.getHealthCheck();

    return {
      status: dbHealth.status,
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      database: dbHealth,
    };
  }

  @Get('database')
  async checkDatabase() {
    return this.databaseService.getHealthCheck();
  }

  @Get('tenants')
  async checkTenants() {
    const schemas = await this.databaseService.listTenantSchemas();

    return {
      total: schemas.length,
      schemas: schemas.slice(0, 10), // First 10 only
    };
  }
}
