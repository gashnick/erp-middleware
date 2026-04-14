// src/database/migrations/public/1705000000014-WhatsAppOtpPublic.ts
//
// PUBLIC schema migration — creates whatsapp_otp_requests.
//
// Why public schema:
//   When an inbound WhatsApp message arrives at the webhook, we only know
//   the sender's phone number. We have no JWT token, no tenant context,
//   and no search_path set. To find which tenant + user the OTP belongs to
//   we must query a global (public schema) table BEFORE we can set
//   search_path to any tenant schema.
//
//   This is the same pattern as public.tenants, public.users, and
//   public.subscriptions — data that must be resolved before tenant
//   context is established.
//
// Table: whatsapp_otp_requests
//   One row per OTP generation request.
//   tenant_id + user_id identify the user who generated the OTP.
//   otp is the 6-digit code the user sends via WhatsApp.
//   used_at is stamped atomically when the OTP is validated —
//   preventing replay attacks (a used OTP cannot be reused).
//   Rows are never deleted — used_at IS NULL partial index keeps
//   lookups fast and old rows serve as an audit trail.

export class WhatsAppOtpPublic1705000000014 {
  public async up(queryRunner: any): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS public."whatsapp_otp_requests" (
        "id"         uuid       NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id"  uuid       NOT NULL,
        "user_id"    uuid       NOT NULL,
        "otp"        varchar(6) NOT NULL,
        "expires_at" timestamp  NOT NULL,
        "used_at"    timestamp,
        "created_at" timestamp  NOT NULL DEFAULT now(),
        CONSTRAINT "PK_whatsapp_otp_requests" PRIMARY KEY ("id"),
        CONSTRAINT "FK_whatsapp_otp_tenant"
          FOREIGN KEY ("tenant_id") REFERENCES public."tenants"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_whatsapp_otp_user"
          FOREIGN KEY ("user_id")   REFERENCES public."users"("id")   ON DELETE CASCADE
      );

      -- Fast OTP lookup on inbound webhook —
      -- unique across (otp, tenant_id) while unused so the same
      -- 6-digit code cannot be reused within the same tenant
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_WHATSAPP_OTP_CODE"
        ON public."whatsapp_otp_requests" ("otp", "tenant_id")
        WHERE "used_at" IS NULL;

      -- Cleanup/expiry queries — only scans unused rows
      CREATE INDEX IF NOT EXISTS "IDX_WHATSAPP_OTP_EXPIRES"
        ON public."whatsapp_otp_requests" ("expires_at")
        WHERE "used_at" IS NULL;

      -- Audit queries: "all OTP requests for this user"
      CREATE INDEX IF NOT EXISTS "IDX_WHATSAPP_OTP_USER"
        ON public."whatsapp_otp_requests" ("user_id", "created_at" DESC);

      -- ── Phone registry ────────────────────────────────────────────────────
      -- Maps phone_number → tenant_id + schema_name + user_id.
      -- Written once at OTP link-time. Read on every inbound webhook message
      -- to resolve which tenant schema to query without scanning all schemas.
      CREATE TABLE IF NOT EXISTS public."whatsapp_phone_registry" (
        "phone_number" varchar   NOT NULL,
        "tenant_id"    uuid      NOT NULL,
        "schema_name"  varchar   NOT NULL,
        "user_id"      uuid      NOT NULL,
        "created_at"   timestamp NOT NULL DEFAULT now(),
        "updated_at"   timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "PK_whatsapp_phone_registry" PRIMARY KEY ("phone_number"),
        CONSTRAINT "FK_wpr_tenant"
          FOREIGN KEY ("tenant_id") REFERENCES public."tenants"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_wpr_user"
          FOREIGN KEY ("user_id") REFERENCES public."users"("id") ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS "IDX_WHATSAPP_PHONE_TENANT"
        ON public."whatsapp_phone_registry" ("tenant_id");
    `);
  }

  public async down(queryRunner: any): Promise<void> {
    await queryRunner.query(`
      DROP TABLE IF EXISTS public."whatsapp_phone_registry";
      DROP TABLE IF EXISTS public."whatsapp_otp_requests";
    `);
  }
}
