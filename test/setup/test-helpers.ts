import request from 'supertest';
import { INestApplication } from '@nestjs/common';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GqlResponse<T = Record<string, unknown>> {
  data: T;
  errors?: { message: string; locations?: unknown; path?: unknown }[];
}

// ---------------------------------------------------------------------------
// REST helpers
// ---------------------------------------------------------------------------

/**
 * Makes authenticated requests as a tenant user.
 * Returns an object whose methods automatically attach the Authorization header.
 * Usage: authenticatedRequest(app, token).post('/path').send({}).expect(201)
 */
export const authenticatedRequest = (app: INestApplication, token: string) => {
  const authHeader = `Bearer ${token}`;

  return {
    get: (url: string) => request(app.getHttpServer()).get(url).set('Authorization', authHeader),
    post: (url: string) => request(app.getHttpServer()).post(url).set('Authorization', authHeader),
    put: (url: string) => request(app.getHttpServer()).put(url).set('Authorization', authHeader),
    patch: (url: string) =>
      request(app.getHttpServer()).patch(url).set('Authorization', authHeader),
    delete: (url: string) =>
      request(app.getHttpServer()).delete(url).set('Authorization', authHeader),
  };
};

/**
 * Makes public (unauthenticated) requests.
 * Returns a SuperTest agent directly.
 * Usage: publicRequest(app).post('/auth/login').send({}).expect(200)
 */
export const publicRequest = (app: INestApplication) => {
  return request(app.getHttpServer());
};

// ---------------------------------------------------------------------------
// GraphQL helper
// ---------------------------------------------------------------------------

/**
 * Sends an authenticated GraphQL request with the required tenant header.
 *
 * TenantContextMiddleware reads `x-tenant-id` to resolve the schema when the
 * JWT alone does not carry a schemaName — passing it here keeps the middleware
 * consistent with how the real frontend calls the API.
 *
 * Returns the parsed `{ data, errors }` body. The caller should assert
 * `expect(res.errors).toBeUndefined()` before accessing `res.data`.
 *
 * Usage:
 *   const res = await graphqlRequest<{ revenueByMonth: MonthlyRevenue[] }>(
 *     app, token, tenantId,
 *     { query: '{ revenueByMonth(year: 2024) { month revenue } }' },
 *   );
 *   expect(res.errors).toBeUndefined();
 *   expect(res.data.revenueByMonth.length).toBeGreaterThan(0);
 */
export const graphqlRequest = async <T = Record<string, unknown>>(
  app: INestApplication,
  token: string,
  tenantId: string,
  body: { query: string; variables?: Record<string, unknown> },
): Promise<GqlResponse<T>> => {
  const res = await request(app.getHttpServer())
    .post('/graphql')
    .set('Authorization', `Bearer ${token}`)
    .set('x-tenant-id', tenantId)
    .set('Content-Type', 'application/json')
    .send(body)
    .expect(200); // GraphQL always responds 200; errors live in res.body.errors

  return res.body as GqlResponse<T>;
};

// ---------------------------------------------------------------------------
// Timing helpers
// ---------------------------------------------------------------------------

/** Resolves after `ms` milliseconds. */
export const waitFor = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Repeatedly calls `fn` until it returns `true` or the attempt limit is reached.
 *
 * @param fn          Async predicate — return `true` to stop polling.
 * @param maxAttempts Maximum number of calls before throwing (default 30).
 * @param delayMs     Milliseconds to wait between calls (default 1 000).
 * @throws Error      When all attempts are exhausted without `fn` returning `true`.
 *
 * Usage:
 *   await pollUntil(
 *     async () => {
 *       const r = await authenticatedRequest(app, token).get(`/etl/jobs/${jobId}`).expect(200);
 *       return r.body.status === 'completed';
 *     },
 *     30,   // max 30 attempts
 *     500,  // check every 500 ms
 *   );
 */
export const pollUntil = async (
  fn: () => Promise<boolean>,
  maxAttempts = 30,
  delayMs = 1_000,
): Promise<void> => {
  for (let i = 0; i < maxAttempts; i++) {
    if (await fn()) return;
    await waitFor(delayMs);
  }
  throw new Error(
    `pollUntil: condition not met after ${maxAttempts} attempts (${(maxAttempts * delayMs) / 1_000}s)`,
  );
};

// ---------------------------------------------------------------------------
// Assertion helpers
// ---------------------------------------------------------------------------

/**
 * Asserts the response carries a 400 validation error mentioning `field`.
 * Handles both `message: string` and `message: string[]` NestJS formats.
 */
export const expectValidationError = (response: any, field: string): void => {
  expect(response.status).toBe(400);

  if (Array.isArray(response.body.message)) {
    expect(response.body.message.some((msg: string) => msg.includes(field))).toBe(true);
  } else {
    expect(response.body.message).toContain(field);
  }
};

/**
 * Extracts `tenantId` and `schemaName` from an organisation-provision response.
 * Falls back to deriving the schema name when the body doesn't include it.
 */
export const extractTenantContext = (response: any): { tenantId: string; schemaName: string } => ({
  tenantId: response.body.tenantId || (response.headers['x-tenant-id'] as string),
  schemaName: response.body.schemaName || `tenant_${response.body.tenantId}`,
});
