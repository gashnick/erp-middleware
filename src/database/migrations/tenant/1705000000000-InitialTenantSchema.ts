export class InitialTenantSchema1705000000000 {
  public async up(queryRunner: any): Promise<void> {
    // -------------------------------------------------------------------------
    // Schema-per-tenant isolation: NO tenant_id columns anywhere.
    // search_path is set to the tenant schema before this runs, so all table
    // names are unqualified and resolve to the correct schema automatically.
    // -------------------------------------------------------------------------
    await queryRunner.query(`

      -- ── Core CRM ────────────────────────────────────────────────────────────

      CREATE TABLE IF NOT EXISTS "contacts" (
        "id"           uuid    NOT NULL DEFAULT gen_random_uuid(),
        "name"         text    NOT NULL,
        "external_id"  varchar,
        "contact_info" jsonb,
        "is_encrypted" boolean NOT NULL DEFAULT false,
        "type"         varchar NOT NULL
                         CHECK ("type" IN ('vendor','customer','supplier','partner','other')),
        CONSTRAINT "PK_contacts" PRIMARY KEY ("id")
      );
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_CONTACT_EXT"
        ON "contacts" ("external_id") WHERE "external_id" IS NOT NULL;

      -- ── Financial records ───────────────────────────────────────────────────

      CREATE TABLE IF NOT EXISTS "invoices" (
        "id"             uuid           NOT NULL DEFAULT gen_random_uuid(),
        "invoice_number" text,
        "customer_name"  text,
        "amount"         decimal(15,2)  NOT NULL,
        "is_encrypted"   boolean        NOT NULL DEFAULT false,
        "external_id"    varchar,
        "currency"       varchar(10)    NOT NULL DEFAULT 'USD',
        "invoice_date"   timestamp,
        "due_date"       timestamp,
        "status"         varchar        NOT NULL DEFAULT 'draft'
                           CHECK ("status" IN ('draft','sent','paid','overdue','void')),
        "vendor_id"      uuid,
        "fingerprint"    text,
        "metadata"       jsonb,
        "created_at"     timestamp      NOT NULL DEFAULT now(),
        CONSTRAINT "PK_invoices"     PRIMARY KEY ("id"),
        CONSTRAINT "FK_invoice_vendor"
          FOREIGN KEY ("vendor_id") REFERENCES "contacts"("id") ON DELETE SET NULL
      );
      -- Non-partial unique index so ON CONFLICT (external_id) can target it
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_INVOICE_EXT"
        ON "invoices" ("external_id");
      CREATE INDEX IF NOT EXISTS "IDX_INVOICE_FINGERPRINT"
        ON "invoices" ("fingerprint") WHERE "fingerprint" IS NOT NULL;
      CREATE INDEX IF NOT EXISTS "IDX_INVOICE_DATE_STATUS"
        ON "invoices" ("invoice_date", "status");

      CREATE TABLE IF NOT EXISTS "expenses" (
        "id"           uuid          NOT NULL DEFAULT gen_random_uuid(),
        "category"     varchar       NOT NULL,
        "vendor_id"    uuid,
        "amount"       decimal(15,2) NOT NULL,
        "currency"     varchar(10)   NOT NULL DEFAULT 'USD',
        "expense_date" timestamp     NOT NULL DEFAULT now(),
        "description"  text,
        "metadata"     jsonb,
        "created_at"   timestamp     NOT NULL DEFAULT now(),
        CONSTRAINT "PK_expenses" PRIMARY KEY ("id"),
        CONSTRAINT "FK_expense_vendor"
          FOREIGN KEY ("vendor_id") REFERENCES "contacts"("id") ON DELETE SET NULL
      );
      CREATE INDEX IF NOT EXISTS "IDX_EXPENSE_DATE"
        ON "expenses" ("expense_date");
      CREATE INDEX IF NOT EXISTS "IDX_EXPENSE_VENDOR"
        ON "expenses" ("vendor_id") WHERE "vendor_id" IS NOT NULL;
      CREATE INDEX IF NOT EXISTS "IDX_EXPENSE_CATEGORY"
        ON "expenses" ("category", "expense_date");

      CREATE TABLE IF NOT EXISTS "bank_transactions" (
        "id"               uuid          NOT NULL DEFAULT gen_random_uuid(),
        "type"             varchar       NOT NULL
                             CHECK ("type" IN ('credit','debit')),
        "amount"           decimal(15,2) NOT NULL CHECK ("amount" > 0),
        "currency"         varchar(10)   NOT NULL DEFAULT 'USD',
        "transaction_date" timestamp     NOT NULL DEFAULT now(),
        "description"      text,
        "reference"        varchar,
        "metadata"         jsonb,
        "created_at"       timestamp     NOT NULL DEFAULT now(),
        CONSTRAINT "PK_bank_transactions" PRIMARY KEY ("id")
      );
      CREATE INDEX IF NOT EXISTS "IDX_BANK_TXN_DATE"
        ON "bank_transactions" ("transaction_date");
      CREATE INDEX IF NOT EXISTS "IDX_BANK_TXN_TYPE_DATE"
        ON "bank_transactions" ("type", "transaction_date");

      -- ── E-commerce ──────────────────────────────────────────────────────────

      CREATE TABLE IF NOT EXISTS "products" (
        "id"          uuid          NOT NULL DEFAULT gen_random_uuid(),
        "name"        varchar       NOT NULL,
        "external_id" varchar,
        "price"       decimal(15,2) NOT NULL,
        "stock"       integer       NOT NULL DEFAULT 0,
        CONSTRAINT "PK_products" PRIMARY KEY ("id")
      );
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_PRODUCT_EXT"
        ON "products" ("external_id") WHERE "external_id" IS NOT NULL;

      CREATE TABLE IF NOT EXISTS "orders" (
        "id"          uuid          NOT NULL DEFAULT gen_random_uuid(),
        "external_id" varchar,
        "channel"     varchar       NOT NULL,
        "amount"      decimal(15,2) NOT NULL,
        "status"      varchar       NOT NULL,
        "items"       jsonb         NOT NULL,
        "created_at"  timestamp     NOT NULL DEFAULT now(),
        CONSTRAINT "PK_orders" PRIMARY KEY ("id")
      );
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_ORDER_EXT"
        ON "orders" ("external_id") WHERE "external_id" IS NOT NULL;

      -- ── ETL quarantine ──────────────────────────────────────────────────────

      CREATE TABLE IF NOT EXISTS "quarantine_records" (
        "id"          uuid      NOT NULL DEFAULT gen_random_uuid(),
        "source_type" varchar   NOT NULL,
        "raw_data"    jsonb     NOT NULL,
        "errors"      jsonb     NOT NULL,
        "status"      varchar   NOT NULL DEFAULT 'pending'
                        CHECK ("status" IN ('pending','reviewed','dismissed')),
        "created_at"  timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "PK_quarantine" PRIMARY KEY ("id")
      );
      CREATE INDEX IF NOT EXISTS "IDX_QUARANTINE_STATUS"
        ON "quarantine_records" ("status", "created_at");

      -- ── AI insights (polymorphic, target_entity names the table) ────────────

      CREATE TABLE IF NOT EXISTS "ai_insights" (
        "id"            uuid           NOT NULL DEFAULT gen_random_uuid(),
        "target_entity" varchar        NOT NULL,
        "target_id"     uuid           NOT NULL,
        "insight_type"  varchar        NOT NULL,
        "message"       text           NOT NULL,
        "confidence"    decimal(3,2)   NOT NULL CHECK ("confidence" BETWEEN 0 AND 1),
        "created_at"    timestamp      NOT NULL DEFAULT now(),
        CONSTRAINT "PK_ai_insights" PRIMARY KEY ("id")
      );
      CREATE INDEX IF NOT EXISTS "IDX_AI_INSIGHTS_TARGET"
        ON "ai_insights" ("target_entity", "target_id");

      -- ── LLM chat ────────────────────────────────────────────────────────────

      CREATE TABLE IF NOT EXISTS "chat_sessions" (
        "id"         uuid      NOT NULL DEFAULT gen_random_uuid(),
        "user_id"    uuid      NOT NULL,
        "created_at" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "PK_chat_sessions" PRIMARY KEY ("id")
      );
      CREATE INDEX IF NOT EXISTS "IDX_CHAT_SESSION_USER"
        ON "chat_sessions" ("user_id");

      CREATE TABLE IF NOT EXISTS "chat_messages" (
        "id"         uuid      NOT NULL DEFAULT gen_random_uuid(),
        "session_id" uuid      NOT NULL,
        "role"       varchar   NOT NULL CHECK ("role" IN ('user','assistant','system')),
        "content"    jsonb     NOT NULL,
        "latency_ms" integer,
        "created_at" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "PK_chat_messages"      PRIMARY KEY ("id"),
        CONSTRAINT "FK_chat_message_session"
          FOREIGN KEY ("session_id") REFERENCES "chat_sessions"("id") ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS "IDX_CHAT_MESSAGES_SESSION"
        ON "chat_messages" ("session_id", "created_at");

      -- ── Anomaly detection ────────────────────────────────────────────────────

      CREATE TABLE IF NOT EXISTS "anomalies" (
        "id"          uuid          NOT NULL DEFAULT gen_random_uuid(),
        "type"        varchar       NOT NULL
                        CHECK ("type" IN ('EXPENSE_SPIKE','DUPLICATE_INVOICE','UNUSUAL_PAYMENT')),
        "score"       decimal(5,4)  NOT NULL CHECK ("score"      BETWEEN 0 AND 1),
        "confidence"  decimal(5,4)  NOT NULL CHECK ("confidence" BETWEEN 0 AND 1),
        "explanation" text          NOT NULL,
        "related_ids" text[]        NOT NULL DEFAULT '{}',
        "detected_at" timestamp     NOT NULL DEFAULT now(),
        CONSTRAINT "PK_anomalies" PRIMARY KEY ("id")
      );
      CREATE INDEX IF NOT EXISTS "IDX_ANOMALIES_SCORE"
        ON "anomalies" ("score" DESC);
      CREATE INDEX IF NOT EXISTS "IDX_ANOMALIES_TYPE_DATE"
        ON "anomalies" ("type", "detected_at" DESC);

      -- ── Knowledge graph ─────────────────────────────────────────────────────

      CREATE TABLE IF NOT EXISTS "kg_entities" (
        "id"          uuid    NOT NULL DEFAULT gen_random_uuid(),
        "type"        varchar NOT NULL
                        CHECK ("type" IN ('CUSTOMER','INVOICE','PAYMENT','ASSET','SUPPLIER')),
        "external_id" varchar NOT NULL,
        "label"       text    NOT NULL,
        "meta"        jsonb   NOT NULL DEFAULT '{}',
        CONSTRAINT "PK_kg_entities"          PRIMARY KEY ("id"),
        CONSTRAINT "UQ_kg_entities_type_ext" UNIQUE ("type", "external_id")
      );
      CREATE INDEX IF NOT EXISTS "IDX_KG_ENTITIES_TYPE"
        ON "kg_entities" ("type");
      CREATE INDEX IF NOT EXISTS "IDX_KG_ENTITIES_LABEL_FTS"
        ON "kg_entities" USING gin (to_tsvector('english', "label"));

      CREATE TABLE IF NOT EXISTS "kg_relationships" (
        "id"             uuid    NOT NULL DEFAULT gen_random_uuid(),
        "from_entity_id" uuid    NOT NULL,
        "to_entity_id"   uuid    NOT NULL,
        "type"           varchar NOT NULL,
        CONSTRAINT "PK_kg_relationships" PRIMARY KEY ("id"),
        CONSTRAINT "FK_kg_rel_from"
          FOREIGN KEY ("from_entity_id") REFERENCES "kg_entities"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_kg_rel_to"
          FOREIGN KEY ("to_entity_id")   REFERENCES "kg_entities"("id") ON DELETE CASCADE,
        CONSTRAINT "UQ_kg_relationships"
          UNIQUE ("from_entity_id", "to_entity_id", "type")
      );
      CREATE INDEX IF NOT EXISTS "IDX_KG_RELATIONSHIPS_FROM"
        ON "kg_relationships" ("from_entity_id");
      CREATE INDEX IF NOT EXISTS "IDX_KG_RELATIONSHIPS_TO"
        ON "kg_relationships" ("to_entity_id");

      -- ── Feedback ─────────────────────────────────────────────────────────────

      CREATE TABLE IF NOT EXISTS "insight_feedback" (
        "id"         uuid      NOT NULL DEFAULT gen_random_uuid(),
        "user_id"    uuid      NOT NULL,
        "insight_id" uuid      NOT NULL,
        "rating"     varchar   NOT NULL CHECK ("rating" IN ('helpful','not_helpful')),
        "comment"    text,
        "created_at" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "PK_insight_feedback" PRIMARY KEY ("id"),
        CONSTRAINT "FK_feedback_insight"
          FOREIGN KEY ("insight_id") REFERENCES "anomalies"("id") ON DELETE CASCADE,
        CONSTRAINT "UQ_insight_feedback"
          UNIQUE ("user_id", "insight_id")
      );
      CREATE INDEX IF NOT EXISTS "IDX_FEEDBACK_INSIGHT"
        ON "insight_feedback" ("insight_id");


      CREATE TABLE IF NOT EXISTS "prompt_templates" (
        "id"         uuid      NOT NULL DEFAULT gen_random_uuid(),
        "name"       varchar   NOT NULL,
        "content"    text      NOT NULL,
        "is_active"  boolean   NOT NULL DEFAULT true,
        "created_at" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "PK_prompt_templates" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_prompt_templates_name" UNIQUE ("name")
);
    `);
  }

  public async down(queryRunner: any): Promise<void> {
    await queryRunner.query(`
      DROP TABLE IF EXISTS "insight_feedback";
      DROP TABLE IF EXISTS "kg_relationships";
      DROP TABLE IF EXISTS "kg_entities";
      DROP TABLE IF EXISTS "prompt_templates";
      DROP TABLE IF EXISTS "anomalies";
      DROP TABLE IF EXISTS "chat_messages";
      DROP TABLE IF EXISTS "chat_sessions";
      DROP TABLE IF EXISTS "ai_insights";
      DROP TABLE IF EXISTS "quarantine_records";
      DROP TABLE IF EXISTS "orders";
      DROP TABLE IF EXISTS "products";
      DROP TABLE IF EXISTS "bank_transactions";
      DROP TABLE IF EXISTS "expenses";
      DROP TABLE IF EXISTS "invoices";
      DROP TABLE IF EXISTS "contacts";
    `);
  }
}
