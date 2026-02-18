import { Injectable, CanActivate, ExecutionContext, HttpException, HttpStatus } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

interface RateLimitConfig {
  free: { requests: number; window: number };
  enterprise: { requests: number; window: number };
}

@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly requestCounts = new Map<string, { count: number; resetAt: number }>();
  
  private readonly limits: RateLimitConfig = {
    free: { requests: 10, window: 60000 }, // 10 requests per minute
    enterprise: { requests: 100, window: 60000 }, // 100 requests per minute
  };

  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const tenantId = request.user?.tenantId;
    const subscriptionPlan = request.user?.subscriptionPlan || 'free';

    if (!tenantId) {
      return true; // Skip rate limiting for non-tenant requests
    }

    const key = `${tenantId}:${request.path}`;
    const now = Date.now();
    const limit = this.limits[subscriptionPlan as keyof RateLimitConfig] || this.limits.free;

    let record = this.requestCounts.get(key);

    if (!record || now > record.resetAt) {
      record = {
        count: 0,
        resetAt: now + limit.window,
      };
      this.requestCounts.set(key, record);
    }

    record.count++;

    if (record.count > limit.requests) {
      const resetIn = Math.ceil((record.resetAt - now) / 1000);
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: `Rate limit exceeded. Try again in ${resetIn} seconds.`,
          limit: limit.requests,
          window: limit.window / 1000,
          resetIn,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // Add rate limit headers
    const response = context.switchToHttp().getResponse();
    response.setHeader('X-RateLimit-Limit', limit.requests);
    response.setHeader('X-RateLimit-Remaining', limit.requests - record.count);
    response.setHeader('X-RateLimit-Reset', record.resetAt);

    return true;
  }
}
