import {
  Body,
  Controller,
  Param,
  Post,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { TenantGuard } from '@common/guards/tenant.guard';
import { FeedbackService } from './feedback.service';

@Controller('insights')
@UseGuards(JwtAuthGuard, TenantGuard)
export class FeedbackController {
  constructor(private readonly feedbackService: FeedbackService) {}

  @Post(':id/feedback')
  @HttpCode(HttpStatus.CREATED)
  submit(
    @Param('id') insightId: string,
    @Body('rating') rating: string,
    @Body('comment') comment: string | undefined,
    @Req() req: Request,
  ) {
    // Controller logic becomes a simple pass-through to the service
    return this.feedbackService.submit(insightId, rating, comment, req);
  }
}
