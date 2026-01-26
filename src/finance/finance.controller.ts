// src/modules/finance/finance.controller.ts
import { Controller, Get, UseGuards, Request } from '@nestjs/common';
import { FinanceService } from './finance.service';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { RolesGuard } from '@auth/guards/roles.guard';
import { Roles } from '@auth/decorators/roles.decorator';
import { Role } from '@auth/enums/role.enum';
import { AuthenticatedRequest } from '@auth/interfaces/authenticated-request.interface';

@Controller('finance')
@UseGuards(JwtAuthGuard, RolesGuard)
export class FinanceController {
  constructor(private readonly financeService: FinanceService) {}

  @Get('dashboard')
  @Roles(Role.ADMIN, Role.MANAGER, Role.ANALYST)
  async getDashboard(@Request() req: AuthenticatedRequest) {
    // Explicitly Typed
    // Now TypeScript knows exactly what req.user.tenantId is!
    return this.financeService.getDashboardStats(req.user.tenantId);
  }
}
