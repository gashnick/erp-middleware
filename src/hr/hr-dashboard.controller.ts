// src/hr/hr-dashboard.controller.ts

import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { TenantGuard } from '@common/guards/tenant.guard';
import { HrDashboardService } from './hr-dashboard.service';
import { EmployeeFilters, CreateEmployeeDto } from './hr.types';
import { FeatureFlagService } from '@subscription/feature-flag.service';
import { getTenantContext } from '@common/context/tenant-context';

@ApiTags('HR Dashboard')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('hr')
export class HrDashboardController {
  constructor(
    private readonly hrService: HrDashboardService,
    private readonly featureFlags: FeatureFlagService,
  ) {}

  // GET /api/hr/headcount?department=engineering&from=2026-01-01&to=2026-03-31
  @Get('headcount')
  async getHeadcount(
    @Query('department') department?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    await this.checkFeature();
    return this.hrService.headcount({ department, from, to });
  }

  // GET /api/hr/headcount/trend?months=12
  @Get('headcount/trend')
  async getHeadcountTrend(@Query('months') months?: string) {
    await this.checkFeature();
    return this.hrService.headcountTrend(months ? parseInt(months, 10) : 12);
  }

  // GET /api/hr/attrition?from=2026-01-01&to=2026-03-31
  @Get('attrition')
  async getAttrition(@Query('from') from?: string, @Query('to') to?: string) {
    await this.checkFeature();
    const now = new Date().toISOString();
    const oneYrAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
    return this.hrService.attrition(from ?? oneYrAgo, to ?? now);
  }

  // GET /api/hr/attrition/risk
  @Get('attrition/risk')
  async getAttritionRisk() {
    await this.checkFeature();
    const now = new Date().toISOString();
    const oneYrAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
    const result = await this.hrService.attrition(oneYrAgo, now);
    return result.riskFlags;
  }

  // GET /api/hr/payroll/summary?department=engineering
  @Get('payroll/summary')
  async getPayrollSummary(@Query('department') department?: string) {
    await this.checkFeature();
    return this.hrService.payrollSummary({ department });
  }

  // GET /api/hr/payroll/breakdown
  @Get('payroll/breakdown')
  async getPayrollBreakdown() {
    await this.checkFeature();
    const summary = await this.hrService.payrollSummary();
    return summary.byDepartment;
  }

  // GET /api/hr/employees?department=engineering&status=active&limit=50&offset=0
  @Get('employees')
  async listEmployees(
    @Query('department') department?: string,
    @Query('status') status?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    await this.checkFeature();
    const filters: EmployeeFilters = {
      department,
      status: status as any,
      from,
      to,
    };
    return this.hrService.listEmployees(
      filters,
      limit ? parseInt(limit, 10) : 50,
      offset ? parseInt(offset, 10) : 0,
    );
  }

  // POST /api/hr/employees — upsert via CSV upload or direct API
  @Post('employees')
  @HttpCode(HttpStatus.CREATED)
  async upsertEmployee(@Body() dto: CreateEmployeeDto) {
    await this.checkFeature();
    if (!dto.name || !dto.department || !dto.role || !dto.startDate) {
      throw new BadRequestException('name, department, role, and startDate are required');
    }
    return this.hrService.upsertEmployee(dto);
  }

  // ── Helper ────────────────────────────────────────────────────────────────

  private async checkFeature(): Promise<void> {
    const ctx = getTenantContext();
    if (!ctx?.tenantId) throw new BadRequestException('Tenant context required');
    await this.featureFlags.checkAndIncrement(ctx.tenantId, 'hr_dashboard').catch((err) => {
      if (err?.status === 403) throw err;
    });
  }
}
