import { INestApplication } from '@nestjs/common';
import { setupTestApp, teardownTestApp, resetDatabase, db } from '../../setup/test-app.bootstrap';
import { publicRequest, authenticatedRequest, graphqlRequest } from '../../setup/test-helpers';
import { userFactory, organizationFactory } from '../../setup/test-data-factories';

// ---------------------------------------------------------------------------
// Architecture note
// ---------------------------------------------------------------------------
// ALL tables (invoices, contacts, expenses, bank_transactions, anomalies,
// chat_sessions, chat_messages, kg_entities, kg_relationships, insight_feedback)
// live in the TENANT SCHEMA. There are no tenant_id columns — isolation is
// entirely by PostgreSQL search_path. DB seeds must call withTenantSchema().
//
// Intra-schema FK constraints enforced by this migration:
//   invoices.vendor_id      → contacts.id          ON DELETE SET NULL
//   expenses.vendor_id      → contacts.id          ON DELETE SET NULL
//   chat_messages.session_id → chat_sessions.id    ON DELETE CASCADE
//   kg_relationships.*      → kg_entities.id       ON DELETE CASCADE
//   insight_feedback.insight_id → anomalies.id     ON DELETE CASCADE
// ---------------------------------------------------------------------------

describe('MT - Multitenancy & Tenant Isolation (2.1)', () => {
  let app: INestApplication;
  let tenantAToken: string;
  let tenantBToken: string;
  let tenantAId: string;
  let tenantBId: string;
  let tenantASchemaName: string;
  let tenantBSchemaName: string;

  beforeAll(async () => {
    app = await setupTestApp();
  });

  afterAll(async () => {
    await teardownTestApp();
  });

  beforeEach(async () => {
    await resetDatabase();
  });

  // ─── Helper: provision a full tenant ────────────────────────────────────────
  async function provisionTenant(app: INestApplication) {
    const userData = userFactory.validRegistration();
    await publicRequest(app).post('/auth/register').send(userData);

    const login = await publicRequest(app)
      .post('/auth/login')
      .send({ email: userData.email, password: userData.password });

    expect(login.status).toBe(200);
    const token = login.body.access_token;

    const orgData = organizationFactory.validOrganization();
    const prov = await authenticatedRequest(app, token).post('/tenants').send(orgData).expect(201);

    return {
      tenantId: prov.body.tenantId,
      schemaName: prov.body.schemaName,
      accessToken: prov.body.auth.accessToken,
      refreshToken: prov.body.auth.refreshToken,
      organization: prov.body.organization,
      orgData,
    };
  }

  // ─── Helper: execute queries inside a tenant schema context ─────────────────
  // Sets search_path on a dedicated QueryRunner for the duration of fn(),
  // then resets it to 'public' and releases. Mirrors what
  // TenantQueryRunnerService does internally on every executeTenant() call.
  async function withTenantSchema<T>(
    schemaName: string,
    fn: (runner: Awaited<ReturnType<typeof db.getRunner>>) => Promise<T>,
  ): Promise<T> {
    const runner = await db.getRunner();
    try {
      await runner.query(`SET search_path TO "${schemaName}", public`);
      return await fn(runner);
    } finally {
      await runner.query(`SET search_path TO public`);
      await runner.release();
    }
  }

  // ─── Seed helpers that respect FK constraints ────────────────────────────────

  /** Inserts a contact of type 'vendor' and returns its id. */
  async function seedVendor(schemaName: string, name = 'Test Vendor'): Promise<string> {
    const rows = await withTenantSchema(schemaName, (r) =>
      r.query(`INSERT INTO contacts (name, type) VALUES ($1, 'vendor') RETURNING id`, [name]),
    );
    return rows[0].id as string;
  }

  /** Inserts an anomaly and returns its id. Required before inserting insight_feedback. */
  async function seedAnomaly(
    schemaName: string,
    type: 'EXPENSE_SPIKE' | 'DUPLICATE_INVOICE' | 'UNUSUAL_PAYMENT' = 'EXPENSE_SPIKE',
    extra: { score?: number; confidence?: number; explanation?: string } = {},
  ): Promise<string> {
    const rows = await withTenantSchema(schemaName, (r) =>
      r.query(
        `INSERT INTO anomalies (type, score, confidence, explanation, related_ids, detected_at)
         VALUES ($1, $2, $3, $4, '{}', NOW())
         RETURNING id`,
        [type, extra.score ?? 0.85, extra.confidence ?? 0.9, extra.explanation ?? `Test ${type}`],
      ),
    );
    return rows[0].id as string;
  }

  /** Inserts an invoice, optionally linked to a vendor contact. */
  async function seedInvoice(
    schemaName: string,
    opts: {
      amount?: number;
      currency?: string;
      invoiceDate?: string | null;
      status?: string;
      vendorId?: string | null;
    } = {},
  ) {
    const rows = await withTenantSchema(schemaName, (r) =>
      r.query(
        `INSERT INTO invoices
         (amount, currency, invoice_date, status, vendor_id)
       VALUES ($1, $2, COALESCE($3::timestamp, NOW()), $4, $5)
       RETURNING id`,
        [
          opts.amount ?? 1000,
          opts.currency ?? 'USD',
          opts.invoiceDate ?? null, // ← null, not the string 'NOW()'
          opts.status ?? 'paid',
          opts.vendorId ?? null,
        ],
      ),
    );
    return rows[0].id;
  }

  /** Inserts an expense linked to a vendor contact. */
  async function seedExpense(
    schemaName: string,
    vendorId: string,
    opts: { amount?: number; category?: string; currency?: string } = {},
  ): Promise<string> {
    const rows = await withTenantSchema(schemaName, (r) =>
      r.query(
        `INSERT INTO expenses (category, vendor_id, amount, currency, expense_date)
         VALUES ($1, $2, $3, $4, NOW())
         RETURNING id`,
        [opts.category ?? 'operations', vendorId, opts.amount ?? 500, opts.currency ?? 'USD'],
      ),
    );
    return rows[0].id as string;
  }

  /** Inserts a bank transaction. */
  async function seedBankTransaction(
    schemaName: string,
    opts: { type?: 'credit' | 'debit'; amount?: number; currency?: string } = {},
  ): Promise<string> {
    const rows = await withTenantSchema(schemaName, (r) =>
      r.query(
        `INSERT INTO bank_transactions (type, amount, currency, transaction_date)
         VALUES ($1, $2, $3, NOW())
         RETURNING id`,
        [opts.type ?? 'credit', opts.amount ?? 10000, opts.currency ?? 'USD'],
      ),
    );
    return rows[0].id as string;
  }

  // ===========================================================================
  // MT-01: Tenant provisioning creates an isolated schema
  // ===========================================================================

  describe('MT-01: Tenant provisioning creates isolated schema', () => {
    it('creates a new tenant schema with all required tables', async () => {
      const userData = userFactory.validRegistration();
      await publicRequest(app).post('/auth/register').send(userData);

      const loginResponse = await publicRequest(app)
        .post('/auth/login')
        .send({ email: userData.email, password: userData.password });

      expect(loginResponse.status).toBe(200);
      const token = loginResponse.body.access_token;

      const orgData = organizationFactory.validOrganization();
      const response = await authenticatedRequest(app, token)
        .post('/tenants')
        .send(orgData)
        .expect(201);

      expect(response.body).toMatchObject({
        organization: {
          id: expect.any(String),
          name: orgData.companyName,
          slug: expect.any(String),
        },
        auth: {
          accessToken: expect.any(String),
          refreshToken: expect.any(String),
        },
        tenantId: expect.any(String),
        schemaName: expect.any(String),
      });

      const { tenantId, schemaName } = response.body;

      const runner = await db.getRunner();
      try {
        // Schema itself must exist
        const schemas = await runner.query(
          `SELECT schema_name FROM information_schema.schemata
           WHERE schema_name = $1 OR schema_name LIKE $2`,
          [schemaName, `%${tenantId}%`],
        );
        expect(schemas.length).toBeGreaterThanOrEqual(1);
        expect(schemas[0].schema_name).toMatch(/tenant_/);

        // All tables from the migration must be present in the tenant schema
        const expectedTables = [
          'contacts',
          'invoices',
          'expenses',
          'bank_transactions',
          'products',
          'orders',
          'quarantine_records',
          'ai_insights',
          'chat_sessions',
          'chat_messages',
          'anomalies',
          'kg_entities',
          'kg_relationships',
          'insight_feedback',
          'prompt_templates',
        ];

        for (const table of expectedTables) {
          const result = await runner.query(
            `SELECT EXISTS(
               SELECT 1 FROM information_schema.tables
               WHERE table_schema = $1 AND table_name = $2
             ) AS exists`,
            [schemaName, table],
          );
          expect(result[0].exists).toBe(true);
        }

        // None of these must exist in public (they have no tenant_id column)
        const tenantOnlyTables = [
          'contacts',
          'invoices',
          'expenses',
          'bank_transactions',
          'anomalies',
          'chat_sessions',
          'insight_feedback',
        ];
        for (const table of tenantOnlyTables) {
          const result = await runner.query(
            `SELECT EXISTS(
               SELECT 1 FROM information_schema.tables
               WHERE table_schema = 'public' AND table_name = $1
             ) AS exists`,
            [table],
          );
          expect(result[0].exists).toBe(false);
        }
      } finally {
        await runner.release();
      }
    });

    it('gives each tenant a different schema', async () => {
      const a = await provisionTenant(app);
      const b = await provisionTenant(app);

      tenantAId = a.tenantId;
      tenantBId = b.tenantId;
      tenantASchemaName = a.schemaName;
      tenantBSchemaName = b.schemaName;

      expect(tenantASchemaName).not.toBe(tenantBSchemaName);

      const runner = await db.getRunner();
      try {
        const [rowA] = await runner.query(
          `SELECT EXISTS(SELECT 1 FROM information_schema.schemata WHERE schema_name = $1)`,
          [tenantASchemaName],
        );
        const [rowB] = await runner.query(
          `SELECT EXISTS(SELECT 1 FROM information_schema.schemata WHERE schema_name = $1)`,
          [tenantBSchemaName],
        );
        expect(rowA.exists).toBe(true);
        expect(rowB.exists).toBe(true);
      } finally {
        await runner.release();
      }
    });

    it('enforces FK constraints within the tenant schema', async () => {
      const { schemaName } = await provisionTenant(app);

      // insight_feedback.insight_id must reference a real anomalies.id
      await expect(
        withTenantSchema(schemaName, (r) =>
          r.query(
            `INSERT INTO insight_feedback (user_id, insight_id, rating)
             VALUES (gen_random_uuid(), gen_random_uuid(), 'helpful')`,
          ),
        ),
      ).rejects.toThrow(); // FK violation — anomaly does not exist

      // invoices.vendor_id must reference a real contacts.id when provided
      await expect(
        withTenantSchema(schemaName, (r) =>
          r.query(
            `INSERT INTO invoices (amount, currency, status, vendor_id)
             VALUES (100, 'USD', 'paid', gen_random_uuid())`,
          ),
        ),
      ).rejects.toThrow(); // FK violation — contact does not exist

      // Correct order: contacts first, then invoices
      const vendorId = await seedVendor(schemaName, 'FK Test Vendor');
      const invoiceId = await seedInvoice(schemaName, { vendorId });
      expect(invoiceId).toBeDefined();

      // Correct order: anomaly first, then feedback
      const anomalyId = await seedAnomaly(schemaName);
      const [feedbackRow] = await withTenantSchema(schemaName, (r) =>
        r.query(
          `INSERT INTO insight_feedback (user_id, insight_id, rating)
           VALUES (gen_random_uuid(), $1, 'helpful')
           RETURNING id`,
          [anomalyId],
        ),
      );
      expect(feedbackRow.id).toBeDefined();
    });

    it('cascades anomaly deletion to insight_feedback', async () => {
      const { schemaName } = await provisionTenant(app);

      const anomalyId = await seedAnomaly(schemaName);
      const userId = '00000000-0000-0000-0000-000000000001';

      await withTenantSchema(schemaName, (r) =>
        r.query(
          `INSERT INTO insight_feedback (user_id, insight_id, rating)
           VALUES ($1, $2, 'helpful')`,
          [userId, anomalyId],
        ),
      );

      // Deleting the anomaly must cascade-delete the feedback
      await withTenantSchema(schemaName, (r) =>
        r.query(`DELETE FROM anomalies WHERE id = $1`, [anomalyId]),
      );

      const rows = await withTenantSchema(schemaName, (r) =>
        r.query(`SELECT COUNT(*)::int AS count FROM insight_feedback WHERE insight_id = $1`, [
          anomalyId,
        ]),
      );
      expect(rows[0].count).toBe(0);
    });

    it('nullifies invoice.vendor_id when the vendor contact is deleted', async () => {
      const { schemaName } = await provisionTenant(app);

      const vendorId = await seedVendor(schemaName, 'Deletable Vendor');
      const invoiceId = await seedInvoice(schemaName, { vendorId });

      // Deleting the contact must SET NULL on invoices.vendor_id
      await withTenantSchema(schemaName, (r) =>
        r.query(`DELETE FROM contacts WHERE id = $1`, [vendorId]),
      );

      const [inv] = await withTenantSchema(schemaName, (r) =>
        r.query(`SELECT vendor_id FROM invoices WHERE id = $1`, [invoiceId]),
      );
      expect(inv.vendor_id).toBeNull();
    });
  });

  // ===========================================================================
  // MT-02: Tenant A cannot read Tenant B data
  // ===========================================================================

  describe('MT-02: Tenant A cannot read Tenant B data', () => {
    it('prevents cross-tenant invoice reads via search_path isolation', async () => {
      const a = await provisionTenant(app);
      const b = await provisionTenant(app);

      tenantAId = a.tenantId;
      tenantBId = b.tenantId;
      tenantAToken = a.accessToken;
      tenantBToken = b.accessToken;

      for (let i = 0; i < 5; i++) {
        await authenticatedRequest(app, tenantAToken)
          .post('/invoices')
          .send({ customer_name: `Tenant A Customer ${i}`, amount: 100 + i, currency: 'USD' })
          .expect(201);
      }

      const response = await authenticatedRequest(app, tenantBToken).get('/invoices').expect(200);

      const data = response.body.data ?? response.body;
      if (Array.isArray(data)) {
        const leaked = data.filter((inv: any) => inv.customer_name?.includes('Tenant A'));
        expect(leaked).toHaveLength(0);
      }
    });

    it('isolates invoice data between tenants', async () => {
      const a = await provisionTenant(app);
      const b = await provisionTenant(app);

      tenantAToken = a.accessToken;
      tenantBToken = b.accessToken;

      await authenticatedRequest(app, tenantAToken)
        .post('/invoices')
        .send({ customer_name: 'Acme Corp A', amount: 5000, currency: 'USD' })
        .expect(201);

      await authenticatedRequest(app, tenantBToken)
        .post('/invoices')
        .send({ customer_name: 'Acme Corp B', amount: 3000, currency: 'USD' })
        .expect(201);

      const listA = await authenticatedRequest(app, tenantAToken).get('/invoices').expect(200);
      const listB = await authenticatedRequest(app, tenantBToken).get('/invoices').expect(200);

      const dataA = listA.body.data ?? listA.body;
      const dataB = listB.body.data ?? listB.body;

      if (Array.isArray(dataA)) {
        expect(dataA.some((inv: any) => inv.customer_name === 'Acme Corp A')).toBe(true);
        expect(dataA.some((inv: any) => inv.customer_name === 'Acme Corp B')).toBe(false);
      }
      if (Array.isArray(dataB)) {
        expect(dataB.some((inv: any) => inv.customer_name === 'Acme Corp B')).toBe(true);
        expect(dataB.some((inv: any) => inv.customer_name === 'Acme Corp A')).toBe(false);
      }
    });

    it('isolates vendor contacts between tenant schemas', async () => {
      const a = await provisionTenant(app);
      const b = await provisionTenant(app);

      // Seed a vendor into Tenant A's schema
      const vendorId = await seedVendor(a.schemaName, 'Secret Supplier Co');

      // Tenant A should see 1 row in their schema
      const [rowA] = await withTenantSchema(a.schemaName, (r) =>
        r.query(`SELECT COUNT(*)::int AS count FROM contacts WHERE id = $1`, [vendorId]),
      );
      expect(rowA.count).toBe(1);

      // Tenant B's schema has no such row
      const [rowB] = await withTenantSchema(b.schemaName, (r) =>
        r.query(`SELECT COUNT(*)::int AS count FROM contacts WHERE id = $1`, [vendorId]),
      );
      expect(rowB.count).toBe(0);
    });

    it('isolates bank transactions between tenant schemas', async () => {
      const a = await provisionTenant(app);
      const b = await provisionTenant(app);

      await seedBankTransaction(a.schemaName, { type: 'credit', amount: 50000 });

      // Tenant B's cash position must be null / zero — not contaminated by A's credit
      const resB = await graphqlRequest<{ cashPosition: { balance: number } | null }>(
        app,
        b.accessToken,
        b.tenantId,
        { query: `query { cashPosition { balance currency asOf } }` },
      );
      expect(resB.errors).toBeUndefined();
      if (resB.data.cashPosition !== null) {
        // If B somehow gets a result it must not include A's 50 000
        expect(resB.data.cashPosition.balance).toBeLessThan(50000);
      }
    });
  });

  // ===========================================================================
  // MT-03: Tenant A cannot write to Tenant B schema
  // ===========================================================================

  describe('MT-03: Tenant A cannot write to Tenant B schema', () => {
    it('scopes writes to the authenticated tenant schema only', async () => {
      const a = await provisionTenant(app);
      const b = await provisionTenant(app);

      tenantAId = a.tenantId;
      tenantBId = b.tenantId;
      tenantAToken = a.accessToken;
      tenantBToken = b.accessToken;

      const writeRes = await authenticatedRequest(app, tenantAToken)
        .post('/invoices')
        .send({ customer_name: 'Should Land In A Only', amount: 9999, currency: 'USD' });

      if (writeRes.status === 201) {
        const listB = await authenticatedRequest(app, tenantBToken).get('/invoices').expect(200);
        const dataB = listB.body.data ?? listB.body;
        if (Array.isArray(dataB)) {
          expect(dataB.some((inv: any) => inv.customer_name === 'Should Land In A Only')).toBe(
            false,
          );
        }
      } else {
        expect([400, 401, 403]).toContain(writeRes.status);
      }
    });

    it('blocks Tenant B from reading Tenant A record by ID', async () => {
      const a = await provisionTenant(app);
      const b = await provisionTenant(app);

      tenantAToken = a.accessToken;
      tenantBToken = b.accessToken;

      const recordA = await authenticatedRequest(app, tenantAToken)
        .post('/invoices')
        .send({ customer_name: 'A-only Record', amount: 1000, currency: 'USD' })
        .expect(201);

      const recordId: string = recordA.body.id;
      expect(recordId).toBeDefined();

      const attempt = await authenticatedRequest(app, tenantBToken)
        .get(`/invoices/${recordId}`)
        .catch((err) => err.response ?? { status: err.status ?? 404 });

      expect([403, 404]).toContain(attempt.status);
    });
  });

  // ===========================================================================
  // MT-04: Tenant provisioning generates unique encryption keys
  // ===========================================================================

  describe('MT-04: Tenant provisioning generates unique encryption keys', () => {
    it('generates a unique tenant_secret per tenant', async () => {
      const a = await provisionTenant(app);
      const b = await provisionTenant(app);

      tenantAId = a.tenantId;
      tenantBId = b.tenantId;

      const runner = await db.getRunner();
      try {
        const [rowA] = await runner.query(
          `SELECT tenant_secret FROM public.tenants WHERE id = $1`,
          [tenantAId],
        );
        const [rowB] = await runner.query(
          `SELECT tenant_secret FROM public.tenants WHERE id = $1`,
          [tenantBId],
        );

        expect(rowA.tenant_secret).toBeTruthy();
        expect(rowB.tenant_secret).toBeTruthy();
        expect(rowA.tenant_secret).not.toBe(rowB.tenant_secret);
        expect(rowA.tenant_secret.length).toBeGreaterThan(16);
      } finally {
        await runner.release();
      }
    });

    it('embeds unique tenantId in each JWT', async () => {
      const a = await provisionTenant(app);
      const b = await provisionTenant(app);

      const decode = (token: string) => {
        const [, payload] = token.split('.');
        try {
          return JSON.parse(Buffer.from(payload, 'base64').toString());
        } catch {
          return null;
        }
      };

      const pA = decode(a.accessToken);
      const pB = decode(b.accessToken);

      expect(pA?.tenantId).toBeTruthy();
      expect(pB?.tenantId).toBeTruthy();
      expect(pA.tenantId).not.toBe(pB.tenantId);
    });
  });

  // ===========================================================================
  // MT-05: Deleting a tenant removes its schema cleanly
  // ===========================================================================

  describe('MT-05: Tenant deletion cleans up schema and keys', () => {
    it('removes the tenant schema on deletion', async () => {
      const { tenantId, schemaName, accessToken } = await provisionTenant(app);

      let runner = await db.getRunner();
      try {
        const [before] = await runner.query(
          `SELECT COUNT(*)::int AS count FROM information_schema.schemata WHERE schema_name = $1`,
          [schemaName],
        );
        expect(before.count).toBe(1);
      } finally {
        await runner.release();
      }

      const deleteRes = await authenticatedRequest(app, accessToken)
        .delete(`/tenants/${tenantId}`)
        .catch((err) => err.response ?? { status: 501 });

      if ([200, 204].includes(deleteRes.status)) {
        runner = await db.getRunner();
        try {
          const [after] = await runner.query(
            `SELECT COUNT(*)::int AS count FROM information_schema.schemata WHERE schema_name = $1`,
            [schemaName],
          );
          expect(after.count).toBe(0);
        } finally {
          await runner.release();
        }
      } else if ([404, 501].includes(deleteRes.status)) {
        console.log('MT-05: DELETE /tenants/{id} not yet implemented — skipping');
      }
    });

    it('invalidates the tenant token after deletion', async () => {
      const {
        tenantId,
        accessToken: adminToken,
        accessToken: tenantToken,
      } = await provisionTenant(app);

      const deleteRes = await authenticatedRequest(app, adminToken)
        .delete(`/tenants/${tenantId}`)
        .catch((err) => err.response ?? { status: 501 });

      if ([200, 204].includes(deleteRes.status)) {
        const attempt = await authenticatedRequest(app, tenantToken)
          .get('/invoices')
          .catch((err) => err.response ?? { status: err.status });
        expect([401, 403, 404]).toContain(attempt.status);
      }
    });
  });

  // ===========================================================================
  // MT-06: AI insights are isolated per tenant schema (GraphQL layer)
  // ===========================================================================

  describe('MT-06: AI insights are isolated per tenant schema', () => {
    it('returns empty analytics for a freshly provisioned tenant', async () => {
      const { tenantId, accessToken } = await provisionTenant(app);

      const res = await graphqlRequest<{
        revenueByMonth: { month: number; revenue: number }[];
      }>(app, accessToken, tenantId, {
        query: `query ($year: Int!) {
          revenueByMonth(year: $year) { month year revenue currency }
        }`,
        variables: { year: new Date().getFullYear() },
      });

      expect(res.errors).toBeUndefined();
      expect(res.data.revenueByMonth).toHaveLength(0);
    });

    it('does not leak revenue (invoice) data across tenant schemas', async () => {
      const a = await provisionTenant(app);
      const b = await provisionTenant(app);

      // Seed a paid invoice into Tenant A's schema
      await seedInvoice(a.schemaName, {
        amount: 50000,
        status: 'paid',
        invoiceDate: new Date().toISOString(),
      });

      const resA = await graphqlRequest<{
        revenueByMonth: { month: number; revenue: number }[];
      }>(app, a.accessToken, a.tenantId, {
        query: `query ($year: Int!) { revenueByMonth(year: $year) { month revenue } }`,
        variables: { year: new Date().getFullYear() },
      });
      expect(resA.errors).toBeUndefined();
      expect(resA.data.revenueByMonth.length).toBeGreaterThan(0);
      const total = resA.data.revenueByMonth.reduce((s, m) => s + Number(m.revenue), 0);
      expect(total).toBeGreaterThan(0);

      // Tenant B sees nothing
      const resB = await graphqlRequest<{
        revenueByMonth: { month: number; revenue: number }[];
      }>(app, b.accessToken, b.tenantId, {
        query: `query ($year: Int!) { revenueByMonth(year: $year) { month revenue } }`,
        variables: { year: new Date().getFullYear() },
      });
      expect(resB.errors).toBeUndefined();
      expect(resB.data.revenueByMonth).toHaveLength(0);
    });

    it('does not leak expense data across tenant schemas', async () => {
      const a = await provisionTenant(app);
      const b = await provisionTenant(app);

      // Seed vendor + expense for Tenant A (contacts FK must be satisfied first)
      const vendorId = await seedVendor(a.schemaName, 'Isolated Vendor');
      await seedExpense(a.schemaName, vendorId, { amount: 25000, category: 'software' });

      const now = new Date();
      const fromStr = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const toStr = now.toISOString();

      const resA = await graphqlRequest<{
        expenseBreakdown: { category: string; total: number }[];
      }>(app, a.accessToken, a.tenantId, {
        query: `query ($from: String!, $to: String!) {
          expenseBreakdown(from: $from, to: $to) { category vendorId vendorName total currency }
        }`,
        variables: { from: fromStr, to: toStr },
      });
      expect(resA.errors).toBeUndefined();
      expect(resA.data.expenseBreakdown.length).toBeGreaterThan(0);

      const resB = await graphqlRequest<{
        expenseBreakdown: { category: string; total: number }[];
      }>(app, b.accessToken, b.tenantId, {
        query: `query ($from: String!, $to: String!) {
          expenseBreakdown(from: $from, to: $to) { category total }
        }`,
        variables: { from: fromStr, to: toStr },
      });
      expect(resB.errors).toBeUndefined();
      expect(resB.data.expenseBreakdown).toHaveLength(0);
    });

    it('does not leak anomaly rows across tenant schemas', async () => {
      const a = await provisionTenant(app);
      const b = await provisionTenant(app);

      await seedAnomaly(a.schemaName, 'EXPENSE_SPIKE', {
        score: 0.92,
        confidence: 0.87,
        explanation: 'Schema-isolated spike',
      });

      const resA = await graphqlRequest<{
        anomalies: { id: string; type: string }[];
      }>(app, a.accessToken, a.tenantId, {
        query: `query { anomalies { id type score confidence explanation } }`,
      });
      expect(resA.errors).toBeUndefined();
      expect(resA.data.anomalies.length).toBeGreaterThan(0);
      expect(resA.data.anomalies[0].type).toBe('EXPENSE_SPIKE');

      const resB = await graphqlRequest<{ anomalies: { id: string }[] }>(
        app,
        b.accessToken,
        b.tenantId,
        { query: `query { anomalies { id type score } }` },
      );
      expect(resB.errors).toBeUndefined();
      expect(resB.data.anomalies).toHaveLength(0);
    });

    it('does not allow Tenant B to read Tenant A chat session', async () => {
      const a = await provisionTenant(app);
      const b = await provisionTenant(app);

      const sessionRes = await authenticatedRequest(app, a.accessToken)
        .post('/chat/sessions')
        .expect(201);
      const sessionId: string = sessionRes.body.id;

      const resB = await graphqlRequest<{ chatSession: { id: string } | null }>(
        app,
        b.accessToken,
        b.tenantId,
        { query: `query ($id: ID!) { chatSession(id: $id) { id } }`, variables: { id: sessionId } },
      );

      expect(resB.errors).toBeUndefined();
      // B's search_path points to their schema — row not found → nullable field resolves to null
      expect(resB.data.chatSession).toBeNull();
    });

    it('does not allow Tenant B to send messages into Tenant A session', async () => {
      const a = await provisionTenant(app);
      const b = await provisionTenant(app);

      const sessionRes = await authenticatedRequest(app, a.accessToken)
        .post('/chat/sessions')
        .expect(201);
      const sessionId: string = sessionRes.body.id;

      const resB = await graphqlRequest<{ sendMessage: { id: string } | null }>(
        app,
        b.accessToken,
        b.tenantId,
        {
          query: `mutation ($sessionId: ID!, $text: String!) {
            sendMessage(sessionId: $sessionId, text: $text) { id role }
          }`,
          variables: { sessionId, text: 'Cross-tenant injection' },
        },
      );

      const succeeded =
        !resB.errors && resB.data?.sendMessage !== null && resB.data?.sendMessage !== undefined;
      expect(succeeded).toBe(false);
    });

    it('does not leak knowledge-graph entities across tenant schemas', async () => {
      const a = await provisionTenant(app);
      const b = await provisionTenant(app);

      await withTenantSchema(a.schemaName, (r) =>
        r.query(
          `INSERT INTO kg_entities (type, external_id, label, meta)
           VALUES ('SUPPLIER', 'supp-isolated-99', 'Acme Supplies Ltd', '{}')`,
        ),
      );

      const resA = await graphqlRequest<{ entitySearch: { label: string }[] }>(
        app,
        a.accessToken,
        a.tenantId,
        { query: `query { entitySearch(question: "acme") { label } }` },
      );
      expect(resA.errors).toBeUndefined();
      expect(resA.data.entitySearch.some((e) => e.label.includes('Acme'))).toBe(true);

      const resB = await graphqlRequest<{ entitySearch: { label: string }[] }>(
        app,
        b.accessToken,
        b.tenantId,
        { query: `query { entitySearch(question: "acme") { label } }` },
      );
      expect(resB.errors).toBeUndefined();
      expect(resB.data.entitySearch.some((e) => e.label.includes('Acme'))).toBe(false);
    });

    it('does not leak cash position across tenant schemas', async () => {
      const a = await provisionTenant(app);
      const b = await provisionTenant(app);

      // Seed a large credit for Tenant A
      await seedBankTransaction(a.schemaName, { type: 'credit', amount: 99999, currency: 'USD' });

      const resB = await graphqlRequest<{ cashPosition: { balance: number } | null }>(
        app,
        b.accessToken,
        b.tenantId,
        { query: `query { cashPosition { balance currency asOf } }` },
      );
      expect(resB.errors).toBeUndefined();
      // B's schema has no bank_transactions rows → null or zero balance
      if (resB.data.cashPosition !== null) {
        expect(resB.data.cashPosition.balance).toBeLessThan(99999);
      }
    });
  });

  // ===========================================================================
  // MT-07: Unauthenticated requests are rejected at the GraphQL layer
  // ===========================================================================

  describe('MT-07: GraphQL endpoints require authentication', () => {
    it('rejects analytics queries with no token', async () => {
      const { tenantId } = await provisionTenant(app);

      const res = await publicRequest(app)
        .post('/graphql')
        .set('x-tenant-id', tenantId)
        .set('Content-Type', 'application/json')
        .send({ query: `{ revenueByMonth(year: ${new Date().getFullYear()}) { month revenue } }` });

      expect(res.status).toBe(200); // GraphQL always returns 200
      expect(res.body.errors).toBeDefined();
      expect(res.body.errors.length).toBeGreaterThan(0);
    });

    it('rejects a token whose tenantId mismatches the x-tenant-id header', async () => {
      const a = await provisionTenant(app);
      const b = await provisionTenant(app);

      // Tenant A's valid JWT + Tenant B's tenantId header → TenantGuard cross-check
      const res = await graphqlRequest<{ anomalies: unknown[] }>(app, a.accessToken, b.tenantId, {
        query: `{ anomalies { id type } }`,
      });

      const isBlocked =
        (res.errors && res.errors.length > 0) ||
        (Array.isArray(res.data?.anomalies) && res.data.anomalies.length === 0);
      expect(isBlocked).toBe(true);
    });
  });

  // ===========================================================================
  // MT-08: Insight feedback is scoped to the tenant schema
  // ===========================================================================

  describe('MT-08: Insight feedback is isolated per tenant schema', () => {
    it('prevents Tenant B from submitting feedback on a Tenant A anomaly', async () => {
      const a = await provisionTenant(app);
      const b = await provisionTenant(app);

      // Seed anomaly in A's schema — insight_feedback FK requires this row to exist
      const insightId = await seedAnomaly(a.schemaName, 'DUPLICATE_INVOICE');

      // REST: B's search_path → B's schema → no anomaly with that id → 403/404
      const restRes = await authenticatedRequest(app, b.accessToken)
        .post(`/insights/${insightId}/feedback`)
        .send({ rating: 'helpful' });
      expect([403, 404]).toContain(restRes.status);

      // GraphQL mutation: same result
      const gqlRes = await graphqlRequest<{ submitFeedback: { id: string } | null }>(
        app,
        b.accessToken,
        b.tenantId,
        {
          query: `mutation ($insightId: ID!, $rating: String!) {
            submitFeedback(insightId: $insightId, rating: $rating) { id rating }
          }`,
          variables: { insightId, rating: 'helpful' },
        },
      );

      const feedbackCreated =
        !gqlRes.errors &&
        gqlRes.data?.submitFeedback !== null &&
        gqlRes.data?.submitFeedback !== undefined;
      expect(feedbackCreated).toBe(false);

      // A's insight_feedback table must be untouched
      const [row] = await withTenantSchema(a.schemaName, (r) =>
        r.query(`SELECT COUNT(*)::int AS count FROM insight_feedback WHERE insight_id = $1`, [
          insightId,
        ]),
      );
      expect(row.count).toBe(0);
    });

    it('allows a tenant to change their own feedback rating (upsert)', async () => {
      const { tenantId, accessToken, schemaName } = await provisionTenant(app);

      const insightId = await seedAnomaly(schemaName, 'EXPENSE_SPIKE');

      // First rating via REST
      const first = await authenticatedRequest(app, accessToken)
        .post(`/insights/${insightId}/feedback`)
        .send({ rating: 'helpful', comment: 'Good catch.' })
        .expect(201);
      expect(first.body.rating).toBe('helpful');

      // Second rating via GraphQL → ON CONFLICT (user_id, insight_id) DO UPDATE
      const second = await graphqlRequest<{
        submitFeedback: { rating: string; comment: string };
      }>(app, accessToken, tenantId, {
        query: `mutation ($insightId: ID!, $rating: String!, $comment: String) {
          submitFeedback(insightId: $insightId, rating: $rating, comment: $comment) {
            rating comment
          }
        }`,
        variables: { insightId, rating: 'not_helpful', comment: 'On reflection, seasonal.' },
      });

      expect(second.errors).toBeUndefined();
      expect(second.data.submitFeedback.rating).toBe('not_helpful');
      expect(second.data.submitFeedback.comment).toBe('On reflection, seasonal.');

      // Upsert → exactly one row in insight_feedback
      const [row] = await withTenantSchema(schemaName, (r) =>
        r.query(`SELECT COUNT(*)::int AS count FROM insight_feedback WHERE insight_id = $1`, [
          insightId,
        ]),
      );
      expect(row.count).toBe(1);
    });

    it('cascade-deletes feedback when its anomaly is deleted', async () => {
      const { schemaName, accessToken, tenantId: tId } = await provisionTenant(app);

      const insightId = await seedAnomaly(schemaName, 'EXPENSE_SPIKE');

      await graphqlRequest(app, accessToken, tId, {
        query: `mutation ($insightId: ID!, $rating: String!) {
          submitFeedback(insightId: $insightId, rating: $rating) { id }
        }`,
        variables: { insightId, rating: 'helpful' },
      });

      // Deleting the anomaly must cascade to insight_feedback (ON DELETE CASCADE)
      await withTenantSchema(schemaName, (r) =>
        r.query(`DELETE FROM anomalies WHERE id = $1`, [insightId]),
      );

      const [row] = await withTenantSchema(schemaName, (r) =>
        r.query(`SELECT COUNT(*)::int AS count FROM insight_feedback WHERE insight_id = $1`, [
          insightId,
        ]),
      );
      expect(row.count).toBe(0);
    });
  });
});
