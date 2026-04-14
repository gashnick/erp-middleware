// src/whatsapp/whatsapp.controller.ts
//
// REST endpoints for the WhatsApp channel.
//
// Route groups:
//
//   PUBLIC (no auth — Meta calls these directly):
//     GET  /api/whatsapp/webhook   — Meta verification handshake
//     POST /api/whatsapp/webhook   — inbound message webhook
//
//   AUTHENTICATED (JwtAuthGuard + TenantGuard):
//     POST /api/whatsapp/configs           — create/update WABA config
//     GET  /api/whatsapp/configs           — get current config (no tokens returned)
//     PUT  /api/whatsapp/configs           — update config fields
//     GET  /api/whatsapp/sessions          — list conversation sessions
//
// Security notes:
//   - Webhook endpoints have NO auth guards — Meta cannot send JWT tokens.
//     Security is enforced via HMAC-SHA256 signature verification inside
//     WhatsAppService.handleInbound() instead.
//   - Config endpoints strip accessToken and appSecret from responses —
//     encrypted values are never returned to the client.

import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Query,
  Headers,
  Res,
  UseGuards,
  BadRequestException,
  HttpCode,
  HttpStatus,
  DefaultValuePipe,
  ParseIntPipe,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { Response } from 'express';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { TenantGuard } from '@common/guards/tenant.guard';
import { getTenantContext } from '@common/context/tenant-context';
import { WhatsAppService } from './whatsapp.service';
import {
  CreateWhatsAppConfigDto,
  UpdateWhatsAppConfigDto,
  MetaWebhookBody,
} from './whatsapp.types';

@ApiTags('WhatsApp')
@Controller('whatsapp')
export class WhatsAppController {
  constructor(private readonly whatsAppService: WhatsAppService) {}

  // ── GET /api/whatsapp/webhook — Meta verification handshake ───────────────
  // No auth — Meta calls this when you first register the webhook URL.
  // Meta sends: hub.mode=subscribe, hub.verify_token, hub.challenge
  // We verify the token and echo back the challenge as plain text.

  @Get('webhook')
  async verifyWebhook(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
    @Res() res: Response,
  ) {
    const result = await this.whatsAppService.verifyWebhook(mode, token, challenge);
    // Meta expects the challenge echoed back as plain text, not JSON
    res.setHeader('Content-Type', 'text/plain');
    res.send(result);
  }

  // ── POST /api/whatsapp/webhook — inbound messages from Meta ───────────────
  // No auth — Meta sends all messages here.
  // HMAC signature is verified inside WhatsAppService.handleInbound().
  // Always respond 200 immediately — Meta retries on any non-200 response,
  // which would cause duplicate message processing.

  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async handleWebhook(
    @Body() body: MetaWebhookBody,
    @Headers('x-hub-signature-256') signature: string,
  ) {
    // Process asynchronously — respond 200 before processing completes
    // so Meta doesn't time out and retry
    this.whatsAppService.handleInbound(body, signature).catch((err) => {
      // Errors are logged inside handleInbound — we never let them
      // bubble up to change the 200 response
    });

    return { status: 'received' };
  }

  // ── POST /api/whatsapp/configs — create/update WABA config ────────────────

  @Post('configs')
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, TenantGuard)
  async createConfig(@Body() dto: CreateWhatsAppConfigDto) {
    this.assertTenantContext();

    if (!dto.phoneNumber?.trim()) throw new BadRequestException('phoneNumber is required');
    if (!dto.wabaId?.trim()) throw new BadRequestException('wabaId is required');
    if (!dto.accessToken?.trim()) throw new BadRequestException('accessToken is required');
    if (!dto.appSecret?.trim()) throw new BadRequestException('appSecret is required');

    return this.whatsAppService.createConfig(dto);
  }

  // ── GET /api/whatsapp/configs — get current config ────────────────────────

  @Get('configs')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, TenantGuard)
  async getConfig() {
    this.assertTenantContext();
    const config = await this.whatsAppService.getConfig();
    if (!config) return { message: 'No WhatsApp config found for this tenant' };
    return config;
  }

  // ── PUT /api/whatsapp/configs — update config fields ──────────────────────

  @Put('configs')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, TenantGuard)
  async updateConfig(@Body() dto: UpdateWhatsAppConfigDto) {
    this.assertTenantContext();
    return this.whatsAppService.updateConfig(dto);
  }

  // ── POST /api/whatsapp/link — generate OTP for phone linking ────────────────
  // Authenticated — user calls this from the app to get a 6-digit code.
  // They then send that code as a WhatsApp message from their phone.

  @Post('link')
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, TenantGuard)
  async generateLinkOtp() {
    const ctx = this.assertTenantContext();
    if (!ctx.userId) throw new BadRequestException('User context required');
    return this.whatsAppService.generateOtp(ctx.userId);
  }

  // ── GET /api/whatsapp/link/status — check if phone is linked ─────────────
  // Frontend polls this after the user sends the OTP to confirm linking.

  @Get('link/status')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, TenantGuard)
  async getLinkStatus() {
    const ctx = this.assertTenantContext();
    if (!ctx.userId) throw new BadRequestException('User context required');
    return this.whatsAppService.getLinkStatus(ctx.userId);
  }

  // ── GET /api/whatsapp/sessions — list conversation sessions ───────────────

  @Get('sessions')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, TenantGuard)
  async listSessions(
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset: number,
  ) {
    this.assertTenantContext();
    return this.whatsAppService.listSessions(limit, offset);
  }

  // ── Private helper ─────────────────────────────────────────────────────────

  private assertTenantContext() {
    const ctx = getTenantContext();
    if (!ctx?.tenantId) throw new BadRequestException('Tenant context required');
    return ctx;
  }
}
