import { Controller, Get, Request } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { FinanceService } from '@finance/finance.service';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { UseGuards } from '@nestjs/common';

@ApiTags('Dashboard')
@Controller('dashboard')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class DashboardController {
  constructor(private readonly financeService: FinanceService) {}

  @Get('finance')
  async finance(@Request() req: any) {
    // Delegate to the finance service. This provides the legacy path expected by tests.
    return this.financeService.getDashboardStats(req.user?.tenantId);
  }
}
