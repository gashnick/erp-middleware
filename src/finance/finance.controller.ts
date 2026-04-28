import {
  Controller,
  Get,
  Query,
  UseGuards,
  Request,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import { FinanceService } from './finance.service';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { TenantGuard } from '@common/guards/tenant.guard';
import { RolesGuard } from '@auth/guards/roles.guard';
import { Roles } from '@auth/decorators/roles.decorator';
import { Role } from '@auth/enums/role.enum';
import { AuthenticatedRequest } from '@auth/interfaces/authenticated-request.interface';

@Controller('finance')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
export class FinanceController {
  constructor(private readonly financeService: FinanceService) {}

  // Existing endpoint — keep as is
  @Get('dashboard')
  @Roles(Role.ADMIN, Role.MANAGER, Role.ANALYST)
  async getDashboard(@Request() req: AuthenticatedRequest) {
    return this.financeService.getDashboardStats(req.user.tenantId);
  }

  // NEW — KPIs for dashboard cards
  @Get('dashboard/kpis')
  @Roles(Role.ADMIN, Role.MANAGER, Role.ANALYST)
  async getKpis(@Request() req: AuthenticatedRequest) {
    return this.financeService.getDashboardKpis(req.user.tenantId);
  }

  // NEW — Revenue chart time series
  @Get('revenue-chart')
  @Roles(Role.ADMIN, Role.MANAGER, Role.ANALYST)
  async getRevenueChart(
    @Request() req: AuthenticatedRequest,
    @Query('months', new DefaultValuePipe(6), ParseIntPipe) months: number,
  ) {
    return this.financeService.getRevenueChart(req.user.tenantId, months);
  }

  // NEW — Paginated invoices list
  @Get('invoices')
  @Roles(Role.ADMIN, Role.MANAGER, Role.ANALYST)
  async getInvoices(
    @Request() req: AuthenticatedRequest,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('status') status?: string,
  ) {
    return this.financeService.getInvoices(req.user.tenantId, { page, limit, status });
  }

  @Get('cash-balance')
  @Roles(Role.ADMIN, Role.MANAGER, Role.ANALYST)
  async getCashBalance(@Request() req: AuthenticatedRequest) {
    return this.financeService.getCashBalance(req.user.tenantId);
  }

  @Get('cash-flow')
  @Roles(Role.ADMIN, Role.MANAGER, Role.ANALYST)
  async getCashFlow(
    @Request() req: AuthenticatedRequest,
    @Query('year', new DefaultValuePipe(new Date().getFullYear()), ParseIntPipe) year: number,
  ) {
    return this.financeService.getCashFlow(req.user.tenantId, year);
  }

  @Get('transactions/recent')
  @Roles(Role.ADMIN, Role.MANAGER, Role.ANALYST)
  async getRecentTransactions(
    @Request() req: AuthenticatedRequest,
    @Query('limit', new DefaultValuePipe(15), ParseIntPipe) limit: number,
  ) {
    return this.financeService.getRecentTransactions(req.user.tenantId, limit);
  }

  @Get('expenses/breakdown')
  @Roles(Role.ADMIN, Role.MANAGER, Role.ANALYST)
  async getExpensesBreakdown(
    @Request() req: AuthenticatedRequest,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    const toDate = to ?? new Date().toISOString().split('T')[0];
    const fromDate =
      from ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    return this.financeService.getExpensesBreakdown(req.user.tenantId, fromDate, toDate);
  }

  @Get('invoices/aging')
  @Roles(Role.ADMIN, Role.MANAGER, Role.ANALYST)
  async getInvoiceAging(@Request() req: AuthenticatedRequest) {
    return this.financeService.getInvoiceAging(req.user.tenantId);
  }
}
