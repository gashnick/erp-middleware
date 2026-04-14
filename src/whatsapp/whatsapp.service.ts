// src/whatsapp/whatsapp.service.ts
//
// Core WhatsApp Business API service.
//
// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║  PHONE-FIRST IDENTITY ARCHITECTURE                                        ║
// ╚═══════════════════════════════════════════════════════════════════════════╝
//
// WhatsApp is our first-touch channel — phone is the primary identity.
// This service implements a strict phone → user → tenant resolution flow:
//
// ┌─ PHASE 1: OTP LINKING (User initiates in mobile app) ────────────────────┐
// │                                                                             │
// │ 1. User clicks "Get WhatsApp Code" in mobile app (authenticated)           │
// │ 2. Mobile calls POST /whatsapp/link → generateOtp(userId)                  │
// │ 3. OTP stored in public.whatsapp_otp_requests:                             │
// │    - tenant_id: current user's tenant                                      │
// │    - user_id: authenticated user (known)                                   │
// │    - otp: 6-digit code (15 min expiry)                                     │
// │ 4. User receives notification with code                                    │
// │ 5. User sends code via WhatsApp: "123456"                                  │
// │                                                                             │
// └─────────────────────────────────────────────────────────────────────────────┘
//
// ┌─ PHASE 2: OTP VALIDATION (Webhook receives inbound message) ───────────────┐
// │                                                                              │
// │ 1. WhatsApp webhook arrives: POST /whatsapp/webhook {from, text: "123456"}  │
// │    NO tenant context, NO JWT, NO user context — only phone number          │
// │                                                                              │
// │ 2. handleInbound() detects 6-digit pattern → handleOtpSubmission()          │
// │                                                                              │
// │ 3. VALIDATE_AND_CONSUME_OTP_SQL: atomic UPDATE with RETURNING              │
// │    - SELECT WHERE otp=$1 AND expires_at > NOW() AND used_at IS NULL        │
// │    - SET used_at = NOW() (prevents replay)                                 │
// │    - RETURNS: user_id + tenant_id (now we know who and where!)             │
// │                                                                              │
// │ 4. Query public.tenants → get schema_name (tenant's isolated schema)        │
// │                                                                              │
// │ 5. Switch to tenant schema, upsert whatsapp_sessions:                       │
// │    - phone_number: the inbound phone (from WhatsApp)                        │
// │    - user_id: <POPULATED from OTP validation>                              │
// │    - context: {} (empty at first)                                          │
// │    ✅ THIS IS WHERE IDENTITY IS ESTABLISHED                                │
// │                                                                              │
// │ 6. Register phone in public.whatsapp_phone_registry:                        │
// │    phone_number → tenant_id + schema_name + user_id                        │
// │    (Bridge table for fast lookups on next inbound)                          │
// │                                                                              │
// │ 7. Send: ✅ "Phone linked successfully!"                                    │
// │                                                                              │
// └──────────────────────────────────────────────────────────────────────────────┘
//
// ┌─ PHASE 3: LINKED PHONE MESSAGING (Subsequent WhatsApp messages) ───────────┐
// │                                                                              │
// │ 1. User sends another message: "What is our cash balance?"                  │
// │    Webhook arrives with {from: "+254711111111", text: "..."}               │
// │                                                                              │
// │ 2. processTextMessage() checks public.whatsapp_phone_registry:              │
// │    SELECT tenant_id, schema_name, user_id                                  │
// │    FROM public.whatsapp_phone_registry                                      │
// │    WHERE phone_number = $1                                                  │
// │                                                                              │
// │    ✅ Returns: tenant_id, schema_name, user_id (all 3 populated)            │
// │                                                                              │
// │ 3. Query tenant schema's whatsapp_sessions:                                 │
// │    SELECT * FROM <schema>.whatsapp_sessions WHERE phone_number = $1        │
// │                                                                              │
// │    ✅ STRICT IDENTITY RULE: If session.user_id IS NULL, BLOCK              │
// │       This prevents data leaks if linking somehow failed                    │
// │                                                                              │
// │ 4. GUARANTEED: At this point user_id is known & verified                    │
// │    - From public.whatsapp_phone_registry                                    │
// │    - From tenant schema whatsapp_sessions.user_id                          │
// │    - Validated to be non-null (security check above)                        │
// │                                                                              │
// │ 5. routeToLlm(phone, text, session, tenantId, schemaName, userId)          │
// │    Sets tenant context → ChatService.handleMessage() → LLM response         │
// │    All operations happen with known identity & tenant scope                 │
// │                                                                              │
// │ 6. Send reply via Meta API                                                  │
// │                                                                              │
// └──────────────────────────────────────────────────────────────────────────────┘
//
// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║  DATA TABLES INVOLVED                                                     ║
// ╚═══════════════════════════════════════════════════════════════════════════╝
//
// public.users (system schema)
// ├─ id (PK)
// ├─ phone_number (UNIQUE NOT NULL for linked users)  ← NEW
// ├─ tenant_id (FK)
// ├─ email, full_name, oauth_provider, etc.
//
// public.whatsapp_otp_requests (system schema)
// ├─ id (PK)
// ├─ tenant_id (FK → public.tenants)
// ├─ user_id (FK → public.users)  ← Populated when user generates OTP
// ├─ otp (VARCHAR 6) — the code
// ├─ phone_number (VARCHAR 20) — which phone submitted it
// ├─ expires_at (TIMESTAMP)
// ├─ used_at (TIMESTAMP) — stamped when consumed (prevents replay)
// ├─ created_at (TIMESTAMP)
//
// public.whatsapp_phone_registry (system schema)  ← BRIDGE TABLE
// ├─ phone_number (PK)  ← The WhatsApp phone from Meta
// ├─ tenant_id (FK)    ← Which tenant owns this phone
// ├─ schema_name (VARCHAR) ← Which schema to query
// ├─ user_id (FK)      ← Which user is this phone linked to
// ├─ created_at, updated_at (TIMESTAMP)
//
// tenant_<name>.whatsapp_sessions (tenant schema, per-tenant)
// ├─ id (PK)
// ├─ phone_number (UNIQUE, VARCHAR)  ← one session per phone per tenant
// ├─ user_id (UUID, NULLABLE)       ← MUST BE NON-NULL for any operations
// ├─ chat_session_id (FK → chat_sessions) ← links to conversation history
// ├─ context (JSONB) ← last intent/topic
// ├─ pending_otp (VARCHAR 6, NULLABLE) ← for re-linking flows
// ├─ otp_expires_at (TIMESTAMP, NULLABLE)
// ├─ last_message_at (TIMESTAMP)
// ├─ created_at, updated_at (TIMESTAMP)
//
// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║  ENFORCEMENT RULES                                                        ║
// ╚═══════════════════════════════════════════════════════════════════════════╝
//
// 🔒 Rule 1: OTP is consumed atomically
//     An OTP can only be used once (used_at is set and never reset)
//     Prevents replay attacks from the same OTP
//
// 🔒 Rule 2: Session user_id cannot be NULL for operations
//     After linking, session.user_id MUST exist
//     If retrieving a session and user_id is NULL → block & require re-link
//     This prevents orphaned sessions that violate tenant isolation
//
// 🔒 Rule 3: Phone registry is the source of truth
//     public.whatsapp_phone_registry is written once at link-time
//     On every inbound message, phone is looked up here first
//     If phone not in registry → user must complete OTP linking
//
// 🔒 Rule 4: Tenant context is established after registry lookup
//     Never assume tenant until phone is validated against registry
//     Schema switching happens only after registry confirms phone ownership
//
// Tenant resolution for webhook flows (no JWT):
//
//   OTP submission:
//     public.whatsapp_otp_requests → tenant_id + user_id → schema_name
//     → transaction({ schema }) to write session
//
//   Linked phone (chat messages):
//     public.whatsapp_phone_registry → tenant_id + schema_name + user_id
//     → transaction({ schema }) to read session + validate user_id + route to LLM
//
//   public.whatsapp_phone_registry is written at link-time and is the
//   single source of truth for phone → tenant mapping across all tenants.

import { Injectable, Logger, ForbiddenException, BadRequestException } from '@nestjs/common';
import { createHmac, timingSafeEqual, randomInt } from 'crypto';
import { getTenantContext, runWithTenantContext } from '@common/context/tenant-context';
import { TenantQueryRunnerService } from '@database/tenant-query-runner.service';
import { EncryptionService } from '@common/security/encryption.service';
import { ChatService } from '@chat/chat.service';
import { WhatsAppTemplateService } from './whatsapp-template.service';
import {
  WhatsAppConfig,
  WhatsAppSession,
  CreateWhatsAppConfigDto,
  UpdateWhatsAppConfigDto,
  MetaWebhookBody,
  MetaMessage,
  SendTextPayload,
  SendTemplatePayload,
  AlertTemplateParams,
  ReportReadyTemplateParams,
  GenerateOtpResult,
  LinkStatusResult,
} from './whatsapp.types';

const OTP_TTL_MINUTES = 15;

@Injectable()
export class WhatsAppService {
  private readonly logger = new Logger(WhatsAppService.name);
  private readonly GRAPH_URL = 'https://graph.facebook.com/v19.0';

  // ── SQL — tenant schema ────────────────────────────────────────────────────

  private static readonly GET_ACTIVE_CONFIG_SQL = `
    SELECT
      id,
      phone_number        AS "phoneNumber",
      waba_id             AS "wabaId",
      access_token        AS "accessToken",
      app_secret          AS "appSecret",
      is_verified         AS "isVerified",
      is_active           AS "isActive",
      webhook_verified_at AS "webhookVerifiedAt",
      created_at          AS "createdAt",
      updated_at          AS "updatedAt"
    FROM whatsapp_configs
    WHERE is_active = true
    LIMIT 1
  `;

  private static readonly INSERT_CONFIG_SQL = `
    INSERT INTO whatsapp_configs
      (phone_number, waba_id, access_token, app_secret)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (phone_number) WHERE is_active = true
    DO UPDATE SET
      waba_id      = EXCLUDED.waba_id,
      access_token = EXCLUDED.access_token,
      app_secret   = EXCLUDED.app_secret,
      updated_at   = now()
    RETURNING
      id,
      phone_number        AS "phoneNumber",
      waba_id             AS "wabaId",
      is_verified         AS "isVerified",
      is_active           AS "isActive",
      webhook_verified_at AS "webhookVerifiedAt",
      created_at          AS "createdAt",
      updated_at          AS "updatedAt"
  `;

  private static readonly MARK_VERIFIED_SQL = `
    UPDATE whatsapp_configs
    SET is_verified = true, webhook_verified_at = now(), updated_at = now()
    WHERE is_active = true
    RETURNING id
  `;

  private static readonly UPDATE_CONFIG_SQL = `
    UPDATE whatsapp_configs SET
      access_token = COALESCE($1, access_token),
      app_secret   = COALESCE($2, app_secret),
      is_active    = COALESCE($3, is_active),
      updated_at   = now()
    WHERE is_active = true
    RETURNING
      id,
      phone_number        AS "phoneNumber",
      waba_id             AS "wabaId",
      is_verified         AS "isVerified",
      is_active           AS "isActive",
      webhook_verified_at AS "webhookVerifiedAt",
      created_at          AS "createdAt",
      updated_at          AS "updatedAt"
  `;

  private static readonly GET_SESSION_BY_PHONE_SQL = `
    SELECT
      id,
      phone_number    AS "phoneNumber",
      user_id         AS "userId",
      chat_session_id AS "chatSessionId",
      context,
      pending_otp     AS "pendingOtp",
      otp_expires_at  AS "otpExpiresAt",
      last_message_at AS "lastMessageAt",
      created_at      AS "createdAt",
      updated_at      AS "updatedAt"
    FROM whatsapp_sessions
    WHERE phone_number = $1
    LIMIT 1
  `;

  private static readonly GET_SESSION_BY_USER_SQL = `
    SELECT
      id,
      phone_number    AS "phoneNumber",
      user_id         AS "userId",
      chat_session_id AS "chatSessionId",
      context,
      pending_otp     AS "pendingOtp",
      otp_expires_at  AS "otpExpiresAt",
      last_message_at AS "lastMessageAt",
      created_at      AS "createdAt",
      updated_at      AS "updatedAt"
    FROM whatsapp_sessions
    WHERE user_id = $1
    LIMIT 1
  `;

  private static readonly UPSERT_SESSION_SQL = `
    INSERT INTO whatsapp_sessions
      (phone_number, user_id, chat_session_id, context)
    VALUES ($1, $2, $3, $4::jsonb)
    ON CONFLICT (phone_number) DO UPDATE SET
      user_id         = COALESCE(EXCLUDED.user_id, whatsapp_sessions.user_id),
      chat_session_id = COALESCE(EXCLUDED.chat_session_id, whatsapp_sessions.chat_session_id),
      context         = EXCLUDED.context,
      last_message_at = now(),
      updated_at      = now()
    RETURNING
      id,
      phone_number    AS "phoneNumber",
      user_id         AS "userId",
      chat_session_id AS "chatSessionId",
      context,
      pending_otp     AS "pendingOtp",
      otp_expires_at  AS "otpExpiresAt",
      last_message_at AS "lastMessageAt",
      created_at      AS "createdAt",
      updated_at      AS "updatedAt"
  `;

  private static readonly LIST_SESSIONS_SQL = `
    SELECT
      id,
      phone_number    AS "phoneNumber",
      user_id         AS "userId",
      chat_session_id AS "chatSessionId",
      context,
      last_message_at AS "lastMessageAt",
      created_at      AS "createdAt",
      updated_at      AS "updatedAt"
    FROM whatsapp_sessions
    ORDER BY last_message_at DESC
    LIMIT $1 OFFSET $2
  `;

  // ── SQL — public schema ────────────────────────────────────────────────────

  private static readonly INSERT_OTP_SQL = `
    INSERT INTO public.whatsapp_otp_requests (tenant_id, user_id, otp, expires_at)
    VALUES ($1, $2, $3, $4)
    RETURNING id, otp, expires_at AS "expiresAt"
  `;

  /**
   * Validates and atomically consumes an OTP.
   * Returns user_id + tenant_id — no tenant filter so this works
   * without any tenant context being established first.
   */
  private static readonly VALIDATE_AND_CONSUME_OTP_SQL = `
    UPDATE public.whatsapp_otp_requests
    SET used_at = now()
    WHERE otp        = $1
      AND expires_at > now()
      AND used_at    IS NULL
    RETURNING
      user_id,
      tenant_id
  `;

  /**
   * Phone registry — written once at link-time, read on every inbound message.
   * Lives in public schema so it is queryable without tenant context.
   * This is the bridge between "phone number" and "which tenant/schema".
   */
  private static readonly REGISTER_PHONE_SQL = `
    INSERT INTO public.whatsapp_phone_registry (phone_number, tenant_id, schema_name, user_id)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (phone_number) DO UPDATE SET
      tenant_id   = EXCLUDED.tenant_id,
      schema_name = EXCLUDED.schema_name,
      user_id     = EXCLUDED.user_id,
      updated_at  = now()
  `;

  private static readonly LOOKUP_PHONE_SQL = `
    SELECT tenant_id, schema_name, user_id
    FROM public.whatsapp_phone_registry
    WHERE phone_number = $1
    LIMIT 1
  `;

  constructor(
    private readonly tenantDb: TenantQueryRunnerService,
    private readonly encryption: EncryptionService,
    private readonly chatService: ChatService,
    private readonly templateService: WhatsAppTemplateService,
  ) {}

  // ── Config management ──────────────────────────────────────────────────────

  async createConfig(
    dto: CreateWhatsAppConfigDto,
  ): Promise<Omit<WhatsAppConfig, 'accessToken' | 'appSecret'>> {
    const encryptedToken = this.encryption.encrypt(dto.accessToken);
    const encryptedSecret = this.encryption.encrypt(dto.appSecret);
    const rows = await this.tenantDb.executeTenant(WhatsAppService.INSERT_CONFIG_SQL, [
      dto.phoneNumber,
      dto.wabaId,
      encryptedToken,
      encryptedSecret,
    ]);
    this.logger.log(`WhatsApp config saved for phone ${dto.phoneNumber}`);
    return rows[0];
  }

  async getConfig(): Promise<Omit<WhatsAppConfig, 'accessToken' | 'appSecret'> | null> {
    const rows = await this.tenantDb.executeTenant<WhatsAppConfig>(
      WhatsAppService.GET_ACTIVE_CONFIG_SQL,
    );
    if (!rows[0]) return null;
    const { accessToken, appSecret, ...safe } = rows[0];
    return safe;
  }

  async updateConfig(
    dto: UpdateWhatsAppConfigDto,
  ): Promise<Omit<WhatsAppConfig, 'accessToken' | 'appSecret'>> {
    const encToken = dto.accessToken ? this.encryption.encrypt(dto.accessToken) : null;
    const encSecret = dto.appSecret ? this.encryption.encrypt(dto.appSecret) : null;
    const rows = await this.tenantDb.executeTenant(WhatsAppService.UPDATE_CONFIG_SQL, [
      encToken,
      encSecret,
      dto.isActive ?? null,
    ]);
    if (!rows[0]) throw new BadRequestException('No active WhatsApp config found');
    const { accessToken, appSecret, ...safe } = rows[0] as WhatsAppConfig;
    return safe;
  }

  // ── OTP phone-linking ──────────────────────────────────────────────────────

  async generateOtp(userId: string): Promise<GenerateOtpResult> {
    const otp = String(randomInt(100000, 999999));
    const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);
    const ctx = this.getTenantCtx();

    await this.tenantDb.executePublic(WhatsAppService.INSERT_OTP_SQL, [
      ctx.tenantId,
      userId,
      otp,
      expiresAt.toISOString(),
    ]);

    this.logger.log(
      `OTP generated for user ${userId} tenant ${ctx.tenantId} — expires ${expiresAt.toISOString()}`,
    );

    return {
      otp,
      expiresAt: expiresAt.toISOString(),
      phoneHint: `Send this code via WhatsApp to link your phone`,
    };
  }

  async getLinkStatus(userId: string): Promise<LinkStatusResult> {
    const rows = await this.tenantDb.executeTenant<{
      phoneNumber: string;
      userId: string;
      lastMessageAt: string;
    }>(WhatsAppService.GET_SESSION_BY_USER_SQL, [userId]);

    const session = rows[0];
    if (!session?.userId) {
      return { linked: false, phoneNumber: null, linkedAt: null };
    }

    return {
      linked: true,
      phoneNumber: this.maskPhone(session.phoneNumber),
      linkedAt: session.lastMessageAt,
    };
  }

  // ── Webhook verification ───────────────────────────────────────────────────

  async verifyWebhook(mode: string, token: string, challenge: string): Promise<string> {
    const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN ?? '';
    if (mode !== 'subscribe' || token !== verifyToken) {
      this.logger.warn(`Webhook verification failed: mode=${mode}`);
      throw new ForbiddenException('Webhook verification failed');
    }
    await this.tenantDb
      .executeTenant(WhatsAppService.MARK_VERIFIED_SQL)
      .catch((err) => this.logger.warn(`Could not mark config verified: ${err.message}`));
    this.logger.log('WhatsApp webhook verified by Meta');
    return challenge;
  }

  // ── Inbound message handler ────────────────────────────────────────────────

  async handleInbound(body: MetaWebhookBody, signature: string): Promise<void> {
    await this.verifySignature(body, signature);
    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        for (const message of change.value?.messages ?? []) {
          if (message.type !== 'text' || !message.text?.body) continue;
          try {
            await this.processTextMessage(message, entry.id);
          } catch (err) {
            this.logger.error(`Failed to process message ${message.id}: ${err.message}`);
          }
        }
      }
    }
  }

  // ── Outbound ───────────────────────────────────────────────────────────────

  async sendAlertNotification(to: string, params: AlertTemplateParams): Promise<void> {
    const payload = this.templateService.buildAlertNotification(to, params);
    await this.sendToMeta(payload);
    this.logger.log(`Alert notification sent to ${to}: ${params.ruleName}`);
  }

  async sendReportReady(to: string, params: ReportReadyTemplateParams): Promise<void> {
    const payload = this.templateService.buildReportReady(to, params);
    await this.sendToMeta(payload);
    this.logger.log(`Report-ready notification sent to ${to}: ${params.reportName}`);
  }

  async listSessions(limit = 20, offset = 0): Promise<WhatsAppSession[]> {
    return this.tenantDb.executeTenant<WhatsAppSession>(WhatsAppService.LIST_SESSIONS_SQL, [
      limit,
      offset,
    ]);
  }

  // ── Private — message routing ──────────────────────────────────────────────

  /**
   * Routes an inbound text message. No tenant context at entry.
   *
   *   'help'    → welcome message (no DB needed)
   *   6 digits  → OTP validation → phone linking
   *   anything  → look up phone in public registry → LLM chat
   */
  private async processTextMessage(message: MetaMessage, wabaId: string): Promise<void> {
    const phone = message.from;
    const text = message.text!.body.trim();

    this.logger.log(`Inbound WhatsApp from ${phone}: "${text.substring(0, 60)}"`);

    // 1. Help
    if (text.toLowerCase() === 'help') {
      await this.sendMessage(phone, this.templateService.buildWelcomeMessage());
      return;
    }

    // 2. OTP
    if (/^\d{6}$/.test(text)) {
      await this.handleOtpSubmission(phone, text);
      return;
    }

    // 3. Linked phone → LLM
    const registry = await this.tenantDb.executePublic<{
      tenant_id: string;
      schema_name: string;
      user_id: string;
    }>(WhatsAppService.LOOKUP_PHONE_SQL, [phone]);

    if (!registry[0]) {
      await this.sendMessage(
        phone,
        `👋 Welcome to CID ERP!\n\n` +
          `To get started, please link your phone:\n` +
          `1️⃣  Open the CID app\n` +
          `2️⃣  Go to Settings → WhatsApp → Get Code\n` +
          `3️⃣  Send the 6-digit code here\n\n` +
          `Type *help* at any time for more info.`,
      );
      return;
    }

    const { tenant_id: tenantId, schema_name: schemaName, user_id: userId } = registry[0];

    // Fetch session from tenant schema using explicit schema context
    const session = await this.tenantDb.transaction(
      async (runner) => {
        const rows = await runner.query(WhatsAppService.GET_SESSION_BY_PHONE_SQL, [phone]);
        return rows[0] as WhatsAppSession | undefined;
      },
      { schema: schemaName, skipSchemaCheck: true },
    );

    if (!session) {
      this.logger.warn(`Phone ${phone} in registry but no session found in ${schemaName}`);
      await this.sendMessage(phone, `❌ Session error — please re-link your phone.`);
      return;
    }

    // ✅ STRICT IDENTITY RULE: session MUST have user_id to proceed
    // This prevents operating with an unknown identity and blocks cross-tenant data leaks
    if (!session.userId) {
      this.logger.error(
        `SECURITY: Session exists for phone ${phone} but user_id is NULL in ${schemaName}. Blocking access.`,
      );
      await this.sendMessage(
        phone,
        `⚠️  Your WhatsApp session is not linked to a user account.\n\n` +
          `Please complete the linking process:\n` +
          `1️⃣  Open the CID app\n` +
          `2️⃣  Go to Settings → WhatsApp → Get Code\n` +
          `3️⃣  Send the 6-digit code here within 15 minutes\n\n` +
          `Until linked, you cannot access messages or data.`,
      );
      return;
    }

    await this.routeToLlm(phone, text, session, tenantId, schemaName, userId);
  }

  /**
   * OTP validation — full flow with no prior tenant context.
   *
   *   1. Consume OTP from public.whatsapp_otp_requests → get user_id + tenant_id
   *   2. Get schema_name from public.tenants
   *   3. Upsert session row in tenant schema with user_id
   *   4. Register phone in public.whatsapp_phone_registry (future message routing)
   */
  private async handleOtpSubmission(phone: string, otp: string): Promise<void> {
    // Step 1 — consume OTP (atomic UPDATE RETURNING prevents replay)
    const otpRows = await this.tenantDb.executePublic<{
      user_id: string;
      tenant_id: string;
    }>(WhatsAppService.VALIDATE_AND_CONSUME_OTP_SQL, [otp]);

    if (otpRows.length === 0) {
      this.logger.warn(`Invalid or expired OTP attempt from ${phone}`);
      await this.sendMessage(
        phone,
        `❌ Invalid or expired code.\n\n` +
          `Codes are valid for ${OTP_TTL_MINUTES} minutes.\n` +
          `Open the CID app to generate a new code.`,
      );
      return;
    }

    const { user_id: userId, tenant_id: tenantId } = otpRows[0];

    if (!userId || !tenantId) {
      this.logger.error(`OTP row missing fields: ${JSON.stringify(otpRows[0])}`);
      await this.sendMessage(phone, `❌ Linking failed — please try again.`);
      return;
    }

    // Step 2 — get schema_name
    const tenantRows = await this.tenantDb.executePublic<{ schema_name: string }>(
      `SELECT schema_name FROM public.tenants WHERE id = $1 LIMIT 1`,
      [tenantId],
    );

    if (!tenantRows[0]) {
      this.logger.error(`Tenant ${tenantId} not found during OTP link`);
      await this.sendMessage(phone, `❌ Linking failed — tenant not found.`);
      return;
    }

    const schemaName = tenantRows[0].schema_name;

    // Step 3 — upsert session in tenant schema
    await this.tenantDb.transaction(
      async (runner) => {
        await runner.query(
          `INSERT INTO whatsapp_sessions (phone_number, user_id, context)
           VALUES ($1, $2, $3::jsonb)
           ON CONFLICT (phone_number) DO UPDATE SET
             user_id        = EXCLUDED.user_id,
             pending_otp    = NULL,
             otp_expires_at = NULL,
             last_message_at = now(),
             updated_at     = now()`,
          [phone, userId, JSON.stringify({})],
        );
      },
      { schema: schemaName, skipSchemaCheck: true },
    );

    // Step 4 — register phone in public registry for future message routing
    await this.tenantDb.executePublic(WhatsAppService.REGISTER_PHONE_SQL, [
      phone,
      tenantId,
      schemaName,
      userId,
    ]);

    this.logger.log(`Phone ${phone} linked to user ${userId} (tenant ${tenantId} / ${schemaName})`);

    await this.sendMessage(
      phone,
      `✅ Phone linked successfully!\n\n` +
        `You can now ask me anything about your business:\n` +
        `• "What is our cash balance?"\n` +
        `• "How many employees do we have?"\n` +
        `• "Are there any SLA breaches?"\n\n` +
        `Type *help* to see all available questions.`,
    );
  }

  private async routeToLlm(
    phone: string,
    text: string,
    session: WhatsAppSession,
    tenantId: string,
    schemaName: string,
    userId: string,
  ): Promise<void> {
    // ✅ Double-check: ensure user_id is populated before routing to LLM
    // This enforces the strict identity rule: never operate without a known user
    if (!userId || !session.userId) {
      this.logger.error(
        `SECURITY VIOLATION: Attempted to route message for phone ${phone} without user_id. Blocking.`,
      );
      await this.sendMessage(
        phone,
        `⚠️  Cannot process your message — your account is not fully linked.\n\n` +
          `Please complete WhatsApp setup in the CID app.`,
      );
      return;
    }

    await runWithTenantContext(
      { tenantId, schemaName, userId, userRole: 'whatsapp_user', userEmail: '' },
      async () => {
        let chatSessionId = session.chatSessionId;

        if (!chatSessionId) {
          const chatSession = await this.chatService.createSession(userId);
          chatSessionId = chatSession.id;

          await this.tenantDb.transaction(
            async (runner) => {
              await runner.query(WhatsAppService.UPSERT_SESSION_SQL, [
                phone,
                userId,
                chatSessionId,
                JSON.stringify(session.context ?? {}),
              ]);
            },
            { schema: schemaName, skipSchemaCheck: true },
          );
        }

        const fakeReq = {
          ip: 'whatsapp-inbound',
          headers: { 'user-agent': 'WhatsApp/Meta' } as any,
        };

        const response = await this.chatService.handleMessage(userId, chatSessionId, text, fakeReq);

        const replyText = this.extractReplyText(response);
        const formatted = this.templateService.formatChatReply(replyText);
        await this.sendMessage(phone, formatted);
      },
    );
  }

  // ── Private — Meta API ─────────────────────────────────────────────────────

  private async sendMessage(to: string, text: string): Promise<void> {
    const payload: SendTextPayload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'text',
      text: { body: text, preview_url: false },
    };
    await this.sendToMeta(payload);
  }

  private async sendToMeta(payload: SendTextPayload | SendTemplatePayload): Promise<void> {
    // Fetch config — try tenant context first, fall back to public schema scan
    let config = await this.getActiveConfigInternal().catch(() => null);

    if (!config) {
      // No tenant context (webhook path) — log and skip, do not throw
      // In production with multiple tenants, route by WABA phone_number_id
      this.logger.warn('No active WhatsApp config found — skipping Meta API call (dev/test mode)');
      return;
    }

    const accessToken = this.encryption.decrypt(config.accessToken);
    const phoneNumberId = config.wabaId;
    const url = `${this.GRAPH_URL}/${phoneNumberId}/messages`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const error = await response.text();
      this.logger.error(`Meta API error ${response.status}: ${error}`);
      throw new Error(`Meta API returned ${response.status}: ${error}`);
    }

    this.logger.debug(`Meta API response: ${response.status}`);
  }

  private async getActiveConfigInternal(): Promise<WhatsAppConfig | null> {
    const rows = await this.tenantDb
      .executeTenant<WhatsAppConfig>(WhatsAppService.GET_ACTIVE_CONFIG_SQL)
      .catch(() => [] as WhatsAppConfig[]);
    return rows[0] ?? null;
  }

  private async verifySignature(body: MetaWebhookBody, signature: string): Promise<void> {
    if (process.env.WHATSAPP_SKIP_SIGNATURE_VERIFY === 'true') {
      this.logger.warn('⚠️  Signature verification DISABLED — dev mode only');
      return;
    }

    if (!signature?.startsWith('sha256=')) {
      throw new ForbiddenException('Missing or invalid X-Hub-Signature-256 header');
    }

    const config = await this.getActiveConfigInternal().catch(() => null);
    if (!config) {
      this.logger.warn('No WhatsApp config — skipping signature verification');
      return;
    }

    const appSecret = this.encryption.decrypt(config.appSecret);
    const bodyString = JSON.stringify(body);
    const expected = createHmac('sha256', appSecret).update(bodyString).digest('hex');
    const receivedHex = signature.replace('sha256=', '');
    const expectedBuf = Buffer.from(expected, 'hex');
    const receivedBuf = Buffer.from(receivedHex, 'hex');

    if (expectedBuf.length !== receivedBuf.length || !timingSafeEqual(expectedBuf, receivedBuf)) {
      this.logger.warn('Webhook signature mismatch — rejecting request');
      throw new ForbiddenException('Webhook signature verification failed');
    }
  }

  // ── Private — utilities ────────────────────────────────────────────────────

  private getTenantCtx() {
    const ctx = getTenantContext();
    if (!ctx?.tenantId) throw new Error('Tenant context missing in WhatsAppService');
    return ctx;
  }

  private extractReplyText(message: any): string {
    if (!message?.content) return 'I could not generate a response. Please try again.';
    const content = message.content;
    if (typeof content === 'string') return content;
    if (content.type === 'text') return content.text ?? content.value ?? '';
    if (content.type === 'table') return content.summary ?? JSON.stringify(content.data ?? {});
    if (content.type === 'chart')
      return content.summary ?? 'Chart data is not displayable in WhatsApp.';
    if (content.type === 'csv') return `Data ready. ${content.summary ?? ''}`.trim();
    if (content.type === 'link') return content.text ?? content.url ?? '';
    return typeof content.text === 'string'
      ? content.text
      : 'Response received. Open the app for full details.';
  }

  private maskPhone(phone: string): string {
    if (phone.length < 6) return phone;
    return `${phone.slice(0, 5)} XXX XXX ${phone.slice(-3)}`;
  }
}
