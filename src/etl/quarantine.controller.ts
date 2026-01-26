// src/etl/quarantine.controller.ts
import { Controller, Get, Post, Body, Param, UseGuards, Req } from '@nestjs/common';
import { Request } from 'express';
import { EtlService } from './etl.service';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';

// Define the shape of your Request with the User payload
interface AuthenticatedRequest extends Request {
  user: {
    userId: string;
    tenantId: string;
    role: string;
  };
}

@Controller('quarantine')
@UseGuards(JwtAuthGuard)
export class QuarantineController {
  constructor(private readonly etlService: EtlService) {}

  @Get()
  async getQuarantine(@Req() req: AuthenticatedRequest) {
    return this.etlService.getQuarantineRecords(req.user.tenantId);
  }

  @Post(':id/retry')
  async retryRecord(
    @Param('id') id: string,
    @Body() fixedData: any,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.etlService.retryQuarantineRecord(req.user.tenantId, id, fixedData);
  }
}
