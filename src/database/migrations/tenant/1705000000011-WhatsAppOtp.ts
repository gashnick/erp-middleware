// src/database/migrations/tenant/1705000000011-WhatsAppOtpTenant.ts
//
// TENANT schema migration — patches whatsapp_sessions with OTP columns.
//
// Why these columns exist on whatsapp_sessions at all:
//   pending_otp and otp_expires_at are kept here as a denormalised
//   convenience for the case where a user re-links their phone while
//   already having an active session (i.e. user_id is already populated).
//   In that case we can write the OTP directly to their session row
//   without going through the public table lookup.
//
//   For the common case (first-time linking, phone not yet known) the
//   OTP lives in public.whatsapp_otp_requests instead.
//   See migration public/1705000000011-WhatsAppOtpPublic.ts.
//
// Runs per-tenant on provisioning — all tenant schema migrations do.

export class WhatsAppOtpTenant1705000000011 {
  public async up(queryRunner: any): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "whatsapp_sessions"
        ADD COLUMN IF NOT EXISTS "pending_otp"    varchar(6),
        ADD COLUMN IF NOT EXISTS "otp_expires_at" timestamp;

      -- Partial index — only indexes rows that currently have a pending OTP
      -- so the index stays tiny and lookups are fast
      CREATE INDEX IF NOT EXISTS "IDX_WHATSAPP_SESSION_OTP"
        ON "whatsapp_sessions" ("pending_otp")
        WHERE "pending_otp" IS NOT NULL;
    `);
  }

  public async down(queryRunner: any): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_WHATSAPP_SESSION_OTP";
      ALTER TABLE "whatsapp_sessions"
        DROP COLUMN IF EXISTS "otp_expires_at",
        DROP COLUMN IF EXISTS "pending_otp";
    `);
  }
}
