import { Controller, Get, Post, Param, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { TenantGuard } from '@common/guards/tenant.guard';
import { ChatService } from './chat.service';
import { getTenantContext } from '@common/context/tenant-context';

@Controller('chat')
@UseGuards(JwtAuthGuard, TenantGuard)
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Post('sessions')
  @HttpCode(HttpStatus.CREATED)
  createSession() {
    const ctx = getTenantContext()!;
    // The middleware and TenantGuard ensure ctx.userId and tenantId are valid here
    return this.chatService.createSession(ctx.userId);
  }

  @Get('sessions/:id')
  getSession(@Param('id') id: string) {
    return this.chatService.getSession(id);
  }
}
