// src/database/migrations/tenant/1705000000010-WhatsApp.ts
//
// Adds WhatsApp Business channel tables to each tenant schema.
//
// whatsapp_configs  — one row per tenant's WhatsApp Business Account (WABA).
//                     access_token is AES-256-GCM encrypted at rest via
//                     EncryptionService. The raw token never touches logs.
//
// whatsapp_sessions — one row per phone number that has messaged the tenant.
//                     Links the phone to a tenant user_id and a chat_session_id
//                     so conversation history is preserved across messages.
//                     context jsonb holds the last intent/topic for continuity.

export class WhatsApp1705000000010 {
  public async up(queryRunner: any): Promise<void> {
    await queryRunner.query(`

      -- ── WhatsApp Business Account config ────────────────────────────────────

      CREATE TABLE IF NOT EXISTS "whatsapp_configs" (
        "id"                   uuid      NOT NULL DEFAULT gen_random_uuid(),
        "phone_number"         varchar   NOT NULL,
        "waba_id"              varchar   NOT NULL,
        "access_token"         text      NOT NULL,  -- AES-256-GCM encrypted
        "app_secret"           text      NOT NULL,  -- AES-256-GCM encrypted, used for HMAC verification
        "is_verified"          boolean   NOT NULL DEFAULT false,
        "is_active"            boolean   NOT NULL DEFAULT true,
        "webhook_verified_at"  timestamp,
        "created_at"           timestamp NOT NULL DEFAULT now(),
        "updated_at"           timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "PK_whatsapp_configs" PRIMARY KEY ("id")
      );

      -- Only one active config per tenant at a time
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_WHATSAPP_ACTIVE_PHONE"
        ON "whatsapp_configs" ("phone_number")
        WHERE "is_active" = true;

      -- ── WhatsApp conversation sessions ────────────────────────────────────────

      CREATE TABLE IF NOT EXISTS "whatsapp_sessions" (
        "id"               uuid      NOT NULL DEFAULT gen_random_uuid(),
        "phone_number"     varchar   NOT NULL,
        "user_id"          uuid,                   -- NULL until phone is linked to a user
        "chat_session_id"  uuid,                   -- links to chat_sessions table for LLM history
        "context"          jsonb     NOT NULL DEFAULT '{}',
        "last_message_at"  timestamp NOT NULL DEFAULT now(),
        "created_at"       timestamp NOT NULL DEFAULT now(),
        "updated_at"       timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "PK_whatsapp_sessions" PRIMARY KEY ("id")
      );

      -- One session per phone number per tenant schema
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_WHATSAPP_SESSION_PHONE"
        ON "whatsapp_sessions" ("phone_number");

      CREATE INDEX IF NOT EXISTS "IDX_WHATSAPP_SESSION_USER"
        ON "whatsapp_sessions" ("user_id")
        WHERE "user_id" IS NOT NULL;

      CREATE INDEX IF NOT EXISTS "IDX_WHATSAPP_SESSION_LAST_MSG"
        ON "whatsapp_sessions" ("last_message_at" DESC);

    `);
  }

  public async down(queryRunner: any): Promise<void> {
    await queryRunner.query(`
      DROP TABLE IF EXISTS "whatsapp_sessions";
      DROP TABLE IF EXISTS "whatsapp_configs";
    `);
  }
}
