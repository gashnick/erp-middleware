// src/database/migrations/system/1705000000015-WhatsAppOtpPhoneNumber.ts
//
// Adds phone_number tracking to public.whatsapp_otp_requests
//
// Why: When a phone submits an OTP, we validate it against the user_id/tenant_id.
// To enable future phone lookups (for linked phones), we store the phone
// number that submitted the code. This prevents needing to search all schemas
// to find which tenant owns a phone.

import { MigrationInterface, QueryRunner } from 'typeorm';

export class WhatsAppOtpPhoneNumber1705000000015 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      -- Add phone_number column to track which phone submitted the OTP
      ALTER TABLE public."whatsapp_otp_requests"
      ADD COLUMN IF NOT EXISTS "phone_number" varchar;

      -- Index for looking up tenant by phone
      CREATE INDEX IF NOT EXISTS "IDX_WHATSAPP_OTP_PHONE"
        ON public."whatsapp_otp_requests" ("phone_number")
        WHERE "phone_number" IS NOT NULL AND "used_at" IS NOT NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS public."IDX_WHATSAPP_OTP_PHONE";
      ALTER TABLE public."whatsapp_otp_requests"
      DROP COLUMN IF EXISTS "phone_number";
    `);
  }
}
