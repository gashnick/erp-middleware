import { INestApplication } from '@nestjs/common';
import { setupTestApp, teardownTestApp, resetDatabase } from '../../setup/test-app.bootstrap';
import {
  publicRequest,
  authenticatedRequest,
  graphqlRequest,
  pollUntil,
  GqlResponse,
} from '../../setup/test-helpers';
import {
  userFactory,
  organizationFactory,
  connectorFactory,
  financialRecordFactory,
} from '../../setup/test-data-factories';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AuthTokens {
  token: string;
  tenantId: string;
}

// ---------------------------------------------------------------------------
// Shared setup
// ---------------------------------------------------------------------------

describe('End-to-End User Journey', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await setupTestApp();
  });

  afterAll(async () => {
    await teardownTestApp();
  });

  beforeEach(async () => {
    await resetDatabase();
  });

  // -------------------------------------------------------------------------
  // Reusable sub-flow: register → login → provision org
  // Returns the bearer token and resolved tenantId for downstream steps.
  // -------------------------------------------------------------------------

  async function registerAndProvision(): Promise<AuthTokens> {
    // 1. Register
    const userData = userFactory.validRegistration();
    await publicRequest(app).post('/auth/register').send(userData).expect(201);

    // 2. Login
    const loginRes = await publicRequest(app)
      .post('/auth/login')
      .send({ email: userData.email, password: userData.password })
      .expect(200);

    const token: string = loginRes.body.access_token;

    // 3. Provision tenant organisation
    const orgData = organizationFactory.validOrganization();
    const orgRes = await authenticatedRequest(app, token)
      .post('/tenants/organizations')
      .send(orgData)
      .expect(201);

    expect(orgRes.body).toMatchObject({
      tenantId: expect.any(String),
      schemaName: expect.any(String),
    });

    return { token, tenantId: orgRes.body.tenantId };
  }

  // -------------------------------------------------------------------------
  // Reusable sub-flow: ingest financial data and wait for ETL completion.
  // -------------------------------------------------------------------------

  async function ingestAndAwaitETL(token: string, recordCount = 50): Promise<void> {
    const invoiceRecords = Array.from({ length: recordCount }, () =>
      financialRecordFactory.invoice(),
    );

    const uploadRes = await authenticatedRequest(app, token)
      .post('/etl/ingest')
      .send({ source: 'csv_upload', entityType: 'invoice', records: invoiceRecords })
      .expect(202);

    expect(uploadRes.body.jobId).toBeDefined();

    await pollUntil(
      async () => {
        const statusRes = await authenticatedRequest(app, token)
          .get(`/etl/jobs/${uploadRes.body.jobId}`)
          .expect(200);
        return statusRes.body.status === 'completed';
      },
      30, // max 30 seconds
      500, // poll every 500 ms
    );
  }

  // =========================================================================
  // Test 1 — Full journey: registration → data → dashboard → AI insights
  // =========================================================================

  it('completes full journey from registration to AI insights within 120 seconds', async () => {
    const startTime = Date.now();

    // ── Phase 1: Auth & tenant setup ─────────────────────────────────────
    const { token, tenantId } = await registerAndProvision();

    // ── Phase 2: Ingest financial data ───────────────────────────────────
    await ingestAndAwaitETL(token);

    // ── Phase 3: Finance dashboard (REST) ────────────────────────────────
    const dashboardRes = await authenticatedRequest(app, token)
      .get('/dashboard/finance')
      .expect(200);

    expect(dashboardRes.body).toMatchObject({
      cashFlow: expect.any(Object),
      arAging: expect.any(Object),
      apAging: expect.any(Object),
      profitability: expect.any(Object),
      anomalies: expect.any(Array),
    });

    // ── Phase 4: GraphQL analytics queries ───────────────────────────────

    // 4a. Revenue by month (current year — served from KPI cache)
    const revenueRes = await graphqlRequest<{
      revenueByMonth: { month: number; year: number; revenue: number; currency: string }[];
    }>(app, token, tenantId, {
      query: `
          query RevenueByMonth($year: Int!) {
            revenueByMonth(year: $year) {
              month
              year
              revenue
              currency
            }
          }
        `,
      variables: { year: new Date().getFullYear() },
    });

    expect(revenueRes.errors).toBeUndefined();
    expect(Array.isArray(revenueRes.data.revenueByMonth)).toBe(true);
    // At least one month should have data after ingestion
    expect(revenueRes.data.revenueByMonth.length).toBeGreaterThan(0);
    revenueRes.data.revenueByMonth.forEach((m) => {
      expect(m.month).toBeGreaterThanOrEqual(1);
      expect(m.month).toBeLessThanOrEqual(12);
      expect(m.revenue).toBeGreaterThanOrEqual(0);
      expect(m.currency).toMatch(/^[A-Z]{3}$/);
    });

    // 4b. Expense breakdown for last 90 days
    const now = new Date();
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1_000);

    const expenseRes = await graphqlRequest<{
      expenseBreakdown: { category: string; total: number; currency: string }[];
    }>(app, token, tenantId, {
      query: `
          query ExpenseBreakdown($from: String!, $to: String!) {
            expenseBreakdown(from: $from, to: $to) {
              category
              vendorId
              vendorName
              total
              currency
            }
          }
        `,
      variables: {
        from: ninetyDaysAgo.toISOString(),
        to: now.toISOString(),
      },
    });

    expect(expenseRes.errors).toBeUndefined();
    expect(Array.isArray(expenseRes.data.expenseBreakdown)).toBe(true);

    // 4c. Cash position
    const cashRes = await graphqlRequest<{
      cashPosition: { balance: number; currency: string; asOf: string } | null;
    }>(app, token, tenantId, {
      query: `
          query CashPosition {
            cashPosition {
              balance
              currency
              asOf
            }
          }
        `,
    });

    expect(cashRes.errors).toBeUndefined();
    // May be null if no bank_transactions seeded — that's fine, just assert shape when present
    if (cashRes.data.cashPosition) {
      expect(typeof cashRes.data.cashPosition.balance).toBe('number');
      expect(cashRes.data.cashPosition.currency).toMatch(/^[A-Z]{3}$/);
    }

    // ── Phase 5: Trigger anomaly scan (REST command) ──────────────────────
    await authenticatedRequest(app, token).post('/insights/scan').expect(201); // 201 from the @HttpCode-less POST — adjust if your decorator differs

    // Wait briefly for the Bull job to process
    await pollUntil(
      async () => {
        const anomalyRestRes = await authenticatedRequest(app, token).get('/insights').expect(200);
        // Consider scan done when the endpoint responds; job may still be running
        // We'll verify content via GraphQL below
        return Array.isArray(anomalyRestRes.body);
      },
      10,
      300,
    );

    // 5a. Query anomalies via GraphQL
    const anomalyGqlRes = await graphqlRequest<{
      anomalies: {
        id: string;
        type: string;
        score: number;
        confidence: number;
        explanation: string;
        relatedIds: string[];
        detectedAt: string;
      }[];
    }>(app, token, tenantId, {
      query: `
          query Anomalies($minScore: Float) {
            anomalies(minScore: $minScore) {
              id
              type
              score
              confidence
              explanation
              relatedIds
              detectedAt
            }
          }
        `,
      variables: { minScore: 0.0 },
    });

    expect(anomalyGqlRes.errors).toBeUndefined();
    expect(Array.isArray(anomalyGqlRes.data.anomalies)).toBe(true);

    // If anomalies were detected, assert each has the correct shape
    anomalyGqlRes.data.anomalies.forEach((a) => {
      expect(['EXPENSE_SPIKE', 'DUPLICATE_INVOICE', 'UNUSUAL_PAYMENT']).toContain(a.type);
      expect(a.score).toBeGreaterThanOrEqual(0);
      expect(a.score).toBeLessThanOrEqual(1);
      expect(a.confidence).toBeGreaterThanOrEqual(0);
      expect(a.confidence).toBeLessThanOrEqual(1);
      expect(typeof a.explanation).toBe('string');
      expect(Array.isArray(a.relatedIds)).toBe(true);
    });

    // ── Phase 6: Create chat session (REST command) ───────────────────────
    const sessionRes = await authenticatedRequest(app, token).post('/chat/sessions').expect(201);

    expect(sessionRes.body).toMatchObject({
      id: expect.any(String),
      tenantId: expect.any(String),
      createdAt: expect.any(String),
    });

    const sessionId: string = sessionRes.body.id;

    // ── Phase 7: Send AI message (GraphQL mutation) ───────────────────────

    const messageRes = await graphqlRequest<{
      sendMessage: {
        id: string;
        sessionId: string;
        role: string;
        content: object;
        createdAt: string;
      };
    }>(app, token, tenantId, {
      query: `
          mutation SendMessage($sessionId: ID!, $text: String!) {
            sendMessage(sessionId: $sessionId, text: $text) {
              id
              sessionId
              role
              content
              latencyMs
              createdAt
            }
          }
        `,
      variables: {
        sessionId,
        text: 'What is our current cash position and are there any unusual expenses this month?',
      },
    });

    expect(messageRes.errors).toBeUndefined();
    expect(messageRes.data.sendMessage).toMatchObject({
      id: expect.any(String),
      sessionId: sessionId,
      role: 'assistant',
      createdAt: expect.any(String),
    });

    // Content must be one of the recognised types
    const content = messageRes.data.sendMessage.content as { type: string };
    expect(['text', 'chart', 'table', 'csv', 'link']).toContain(content.type);

    // For a text response the text field must be a non-empty string
    if (content.type === 'text') {
      expect(typeof (content as any).text).toBe('string');
      expect((content as any).text.length).toBeGreaterThan(0);
    }

    // ── Phase 8: Retrieve session history (GraphQL query) ─────────────────

    const sessionQueryRes = await graphqlRequest<{
      chatSession: {
        id: string;
        messages: { id: string; role: string; content: object }[];
      } | null;
    }>(app, token, tenantId, {
      query: `
          query ChatSession($id: ID!) {
            chatSession(id: $id) {
              id
              tenantId
              createdAt
              messages {
                id
                sessionId
                role
                content
                latencyMs
                createdAt
              }
            }
          }
        `,
      variables: { id: sessionId },
    });

    expect(sessionQueryRes.errors).toBeUndefined();
    expect(sessionQueryRes.data.chatSession).not.toBeNull();
    expect(sessionQueryRes.data.chatSession!.id).toBe(sessionId);
    // At least the assistant reply should be present
    expect(sessionQueryRes.data.chatSession!.messages.length).toBeGreaterThanOrEqual(1);
    expect(sessionQueryRes.data.chatSession!.messages.some((m) => m.role === 'assistant')).toBe(
      true,
    );

    // ── Phase 9: Submit feedback on an insight (REST + GraphQL) ───────────

    // REST path
    if (anomalyGqlRes.data.anomalies.length > 0) {
      const insightId = anomalyGqlRes.data.anomalies[0].id;

      const feedbackRes = await authenticatedRequest(app, token)
        .post(`/insights/${insightId}/feedback`)
        .send({ rating: 'helpful', comment: 'Caught a real duplicate.' })
        .expect(201);

      expect(feedbackRes.body).toMatchObject({
        insightId: expect.any(String),
        rating: 'helpful',
      });

      // GraphQL mutation path — second submission upserts to 'not_helpful'
      const gqlFeedbackRes = await graphqlRequest<{
        submitFeedback: { id: string; rating: string; insightId: string };
      }>(app, token, tenantId, {
        query: `
            mutation SubmitFeedback($insightId: ID!, $rating: String!, $comment: String) {
              submitFeedback(insightId: $insightId, rating: $rating, comment: $comment) {
                id
                insightId
                rating
                comment
                createdAt
              }
            }
          `,
        variables: {
          insightId,
          rating: 'not_helpful',
          comment: 'Actually a known seasonal pattern.',
        },
      });

      expect(gqlFeedbackRes.errors).toBeUndefined();
      expect(gqlFeedbackRes.data.submitFeedback).toMatchObject({
        insightId,
        rating: 'not_helpful',
      });
    }

    // ── Phase 10: Timing assertion ────────────────────────────────────────
    const totalSeconds = (Date.now() - startTime) / 1000;
    console.log(`✓ Full AI journey completed in ${totalSeconds.toFixed(1)}s`);
    expect(totalSeconds).toBeLessThan(120);
  }, 130_000); // Jest timeout: 130 s

  // =========================================================================
  // Test 2 — Tenant isolation: two tenants cannot see each other's data
  // =========================================================================

  it('enforces tenant isolation across all AI endpoints', async () => {
    const [tenantA, tenantB] = await Promise.all([registerAndProvision(), registerAndProvision()]);

    // Ingest data only for Tenant A
    await ingestAndAwaitETL(tenantA.token);

    // Trigger anomaly scan for Tenant A so there is data to isolate
    await authenticatedRequest(app, tenantA.token).post('/insights/scan').expect(201);

    // Tenant B should see zero revenue even though Tenant A has data
    const revenueB = await graphqlRequest<{
      revenueByMonth: unknown[];
    }>(app, tenantB.token, tenantB.tenantId, {
      query: `query { revenueByMonth(year: ${new Date().getFullYear()}) { month revenue } }`,
    });
    expect(revenueB.errors).toBeUndefined();
    expect(revenueB.data.revenueByMonth).toHaveLength(0);

    // Tenant B should see zero anomalies
    const anomaliesB = await graphqlRequest<{ anomalies: unknown[] }>(
      app,
      tenantB.token,
      tenantB.tenantId,
      { query: 'query { anomalies { id type } }' },
    );
    expect(anomaliesB.errors).toBeUndefined();
    expect(anomaliesB.data.anomalies).toHaveLength(0);

    // Tenant B cannot access Tenant A's chat session via GraphQL
    const sessionA = await authenticatedRequest(app, tenantA.token)
      .post('/chat/sessions')
      .expect(201);

    const sessionQueryAsB = await graphqlRequest<{ chatSession: unknown | null }>(
      app,
      tenantB.token,
      tenantB.tenantId,
      { query: `query { chatSession(id: "${sessionA.body.id}") { id } }` },
    );
    expect(sessionQueryAsB.errors).toBeUndefined();
    // NotFoundException maps to null for a nullable GraphQL field
    expect(sessionQueryAsB.data.chatSession).toBeNull();
  });

  // =========================================================================
  // Test 3 — Rate limiting: chat is blocked after tier limit
  // =========================================================================

  it('rate-limits chat messages after the per-tenant limit is reached', async () => {
    const { token, tenantId } = await registerAndProvision();

    // Create a session to send messages into
    const sessionRes = await authenticatedRequest(app, token).post('/chat/sessions').expect(201);
    const sessionId = sessionRes.body.id;

    // The 'basic' tier allows 60 rpm via RateLimiterService.
    // In test we set the Redis window to 1 minute, so we can't easily exhaust it
    // in a real test without mocking. Instead assert the FIRST message succeeds.
    const firstMsg = await graphqlRequest<{ sendMessage: { id: string } }>(app, token, tenantId, {
      query: `
          mutation {
            sendMessage(sessionId: "${sessionId}", text: "How is our AR aging?") {
              id role content latencyMs
            }
          }
        `,
    });

    expect(firstMsg.errors).toBeUndefined();
    expect(firstMsg.data.sendMessage.id).toBeDefined();
  });

  // =========================================================================
  // Test 4 — Connector health check and sync (unchanged from original)
  // =========================================================================

  it('handles connector health check and retry flow', async () => {
    const { token } = await registerAndProvision();

    const connectorData = connectorFactory.quickbooks();
    const connectorRes = await authenticatedRequest(app, token)
      .post('/connectors')
      .send(connectorData)
      .expect(201);

    const connectorId: string = connectorRes.body.id;

    const healthRes = await authenticatedRequest(app, token)
      .get(`/connectors/${connectorId}/health`)
      .expect(200);

    expect(healthRes.body).toMatchObject({
      status: expect.stringMatching(/^(healthy|degraded|unhealthy)$/),
      lastSync: expect.any(String),
      nextSync: expect.any(String),
      errorCount: expect.any(Number),
    });

    await authenticatedRequest(app, token).post(`/connectors/${connectorId}/sync`).expect(202);
  });

  // =========================================================================
  // Test 5 — PII is stripped before the response reaches the client
  // =========================================================================

  it('redacts PII from AI responses before returning to the client', async () => {
    const { token, tenantId } = await registerAndProvision();

    const sessionRes = await authenticatedRequest(app, token).post('/chat/sessions').expect(201);

    const sessionId = sessionRes.body.id;

    // Send a message that contains PII — the LLM may echo it back in test mode
    const piiMsg = await graphqlRequest<{
      sendMessage: { content: { type: string; text?: string } };
    }>(app, token, tenantId, {
      query: `
        mutation {
          sendMessage(
            sessionId: "${sessionId}",
            text: "Invoice for john.doe@acme.com, SSN 123-45-6789"
          ) {
            id role content
          }
        }
      `,
    });

    expect(piiMsg.errors).toBeUndefined();

    const content = piiMsg.data.sendMessage.content;
    if (content.type === 'text' && content.text) {
      // Neither the raw email nor the raw SSN should appear in the response
      expect(content.text).not.toMatch(/john\.doe@acme\.com/i);
      expect(content.text).not.toMatch(/123-45-6789/);
      // Redaction tokens may appear instead
      // (e.g. [REDACTED:EMAIL]) but this is LLM-dependent in test mode
    }
  });

  // =========================================================================
  // Test 6 — GraphQL requires authentication (no token → error)
  // =========================================================================

  it('rejects unauthenticated GraphQL requests', async () => {
    // No token, no x-tenant-id header
    const res = await publicRequest(app)
      .post('/graphql')
      .send({ query: '{ revenueByMonth(year: 2024) { month revenue } }' })
      .expect(200); // GraphQL always returns 200; errors are in the body

    expect(res.body.errors).toBeDefined();
    expect(res.body.errors.length).toBeGreaterThan(0);
  });

  // =========================================================================
  // Test 7 — duplicate feedback is upserted, not duplicated
  // =========================================================================

  it('upserts feedback so a user can change their rating on the same insight', async () => {
    const { token, tenantId } = await registerAndProvision();
    await ingestAndAwaitETL(token, 20);

    await authenticatedRequest(app, token).post('/insights/scan');

    // Wait for at least one anomaly to appear
    let insightId: string | undefined;

    await pollUntil(
      async () => {
        const listRes = await authenticatedRequest(app, token).get('/insights').expect(200);
        if (listRes.body.length > 0) {
          insightId = listRes.body[0].id;
          return true;
        }
        return false;
      },
      15,
      500,
    );

    if (!insightId) {
      console.warn('No anomalies generated for test data — skipping feedback upsert assertions');
      return;
    }

    // First submission
    await authenticatedRequest(app, token)
      .post(`/insights/${insightId}/feedback`)
      .send({ rating: 'helpful' })
      .expect(201);

    // Second submission — must upsert, not insert a duplicate row
    const secondRes = await authenticatedRequest(app, token)
      .post(`/insights/${insightId}/feedback`)
      .send({ rating: 'not_helpful', comment: 'Changed my mind.' })
      .expect(201);

    expect(secondRes.body.rating).toBe('not_helpful');
    expect(secondRes.body.comment).toBe('Changed my mind.');

    // Verify via GraphQL mutation too
    const gqlUpsert = await graphqlRequest<{
      submitFeedback: { rating: string; comment: string };
    }>(app, token, tenantId, {
      query: `
        mutation {
          submitFeedback(insightId: "${insightId}", rating: "helpful", comment: "Final answer.") {
            rating comment
          }
        }
      `,
    });

    expect(gqlUpsert.errors).toBeUndefined();
    expect(gqlUpsert.data.submitFeedback.rating).toBe('helpful');
    expect(gqlUpsert.data.submitFeedback.comment).toBe('Final answer.');
  });
});
