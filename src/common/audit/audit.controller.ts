// src/common/audit/audit.controller.ts
import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { AuditService } from './audit.service';
import { AuthenticatedRequest } from '@auth/interfaces/authenticated-request.interface';

@Controller('audit')
@UseGuards(JwtAuthGuard)
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  async getLogs(@Req() req: AuthenticatedRequest) {
    // TypeScript now knows req.user exists and has a tenantId!
    return this.auditService.getTenantLogs(req.user.tenantId);
  }

  @Get()
  async getMyLogs(@Req() req: any) {
    // req.user.tenantId comes from the JwtAuthGuard/Strategy
    return this.auditService.getTenantLogs(req.user.tenantId);
  }
}
