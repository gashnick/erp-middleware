import { randomUUID } from 'crypto';

export class AppError extends Error {
  public readonly correlationId: string;
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number = 500,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = this.constructor.name;
    this.correlationId = randomUUID();
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, id: string) {
    super('NOT_FOUND', `${resource} ${id} not found`, 404);
  }
}

export class ForbiddenError extends AppError {
  constructor(msg = 'Access denied') {
    super('FORBIDDEN', msg, 403);
  }
}

export class RateLimitError extends AppError {
  constructor(public readonly retryAfterMs: number) {
    super('RATE_LIMITED', 'Rate limit exceeded', 429);
  }
}

export class LLMUnavailableError extends AppError {
  constructor(provider: string) {
    super('LLM_UNAVAILABLE', `LLM provider ${provider} unavailable after retries`, 503);
  }
}

export class ValidationError extends AppError {
  constructor(details: unknown) {
    super('VALIDATION_ERROR', 'Validation failed', 400, details);
  }
}
