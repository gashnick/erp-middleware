import request from 'supertest'; // Changed from: import * as request from 'supertest';
import { INestApplication } from '@nestjs/common';

/**
 * Makes authenticated requests as a tenant user
 * Returns an object with methods that automatically include the Auth header
 */
export const authenticatedRequest = (app: INestApplication, token: string) => {
  const req = request(app.getHttpServer());
  const authHeader = `Bearer ${token}`;

  return {
    get: (url: string) => req.get(url).set('Authorization', authHeader),
    post: (url: string) => req.post(url).set('Authorization', authHeader),
    put: (url: string) => req.put(url).set('Authorization', authHeader),
    patch: (url: string) => req.patch(url).set('Authorization', authHeader),
    delete: (url: string) => req.delete(url).set('Authorization', authHeader),
  };
};

/**
 * Makes public (unauthenticated) requests
 */
export const publicRequest = (app: INestApplication) => {
  return request(app.getHttpServer());
};

/**
 * Waits for async operations (like ETL processing)
 */
export const waitFor = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Polls an endpoint until a condition is met or timeout
 */
export const pollUntil = async (
  fn: () => Promise<boolean>,
  maxAttempts = 30,
  delayMs = 1000,
): Promise<void> => {
  for (let i = 0; i < maxAttempts; i++) {
    if (await fn()) return;
    await waitFor(delayMs);
  }
  throw new Error('Polling timeout exceeded');
};

/**
 * Validates response structure matches expected schema
 */
/**
 * Validates response contains validation error for a specific field
 */
export const expectValidationError = (response: any, field: string) => {
  expect(response.status).toBe(400);

  // Handle both string and array message formats
  if (Array.isArray(response.body.message)) {
    expect(response.body.message.some((msg: string) => msg.includes(field))).toBe(true);
  } else {
    expect(response.body.message).toContain(field);
  }
};

/**
 * Extracts tenant context from response headers or body
 */
export const extractTenantContext = (response: any): { tenantId: string; schemaName: string } => {
  return {
    tenantId: response.body.tenantId || response.headers['x-tenant-id'],
    schemaName: response.body.schemaName || `tenant_${response.body.tenantId}`,
  };
};
