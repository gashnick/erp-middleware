import { Injectable, CanActivate, ExecutionContext, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';

interface RateLimitConfig {
  free: { requests: number; window: number };
  enterprise: { requests: number; window: number };
}

@Injectable()
export class ProductionRateLimitGuard implements CanActivate {
  private readonly logger = new Logger(ProductionRateLimitGuard.name);
  private readonly limits: RateLimitConfig = {
    free: { requests: 100, window: 3600 }, // 100 requests per hour
    enterprise: { requests: 1000, window: 3600 }, // 1000 requests per hour
  };

  // Fallback in-memory store (only for development)
  private readonly memoryStore = new Map<string, { count: number; resetAt: number }>();
  private readonly useRedis: boolean;

  constructor(
    private reflector: Reflector,
    private configService: ConfigService,
  ) {
    this.useRedis = this.configService.get('REDIS_ENABLED', 'false') === 'true';
    
    if (!this.useRedis) {
      this.logger.warn('Rate limiting using in-memory store. Enable Redis for production.');
    }
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();
    
    // Extract identifier (IP + tenant)
    const ip = this.getClientIp(request);
    const tenantId = request.user?.tenantId || 'anonymous';
    const subscriptionPlan = request.user?.subscriptionPlan || 'free';
    const key = `ratelimit:${ip}:${tenantId}:${request.path}`;

    const limit = this.limits[subscriptionPlan as keyof RateLimitConfig] || this.limits.free;

    let allowed: boolean;
    let remaining: number;
    let resetAt: number;

    if (this.useRedis) {
      ({ allowed, remaining, resetAt } = await this.checkRedis(key, limit));
    } else {
      ({ allowed, remaining, resetAt } = this.checkMemory(key, limit));
    }

    // Set rate limit headers
    response.setHeader('X-RateLimit-Limit', limit.requests);
    response.setHeader('X-RateLimit-Remaining', Math.max(0, remaining));
    response.setHeader('X-RateLimit-Reset', resetAt);

    if (!allowed) {
      const retryAfter = Math.ceil((resetAt - Date.now()) / 1000);
      
      this.logger.warn(`Rate limit exceeded for ${ip} on ${request.path}`);
      
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: `Rate limit exceeded. Try again in ${retryAfter} seconds.`,
          limit: limit.requests,
          window: limit.window,
          retryAfter,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }

  private async checkRedis(
    key: string,
    limit: { requests: number; window: number }
  ): Promise<{ allowed: boolean; remaining: number; resetAt: number }> {
    // TODO: Implement Redis integration
    // For now, fallback to memory
    this.logger.warn('Redis not implemented, using memory fallback');
    return this.checkMemory(key, limit);
  }

  private checkMemory(
    key: string,
    limit: { requests: number; window: number }
  ): { allowed: boolean; remaining: number; resetAt: number } {
    const now = Date.now();
    let record = this.memoryStore.get(key);

    if (!record || now > record.resetAt) {
      record = {
        count: 0,
        resetAt: now + limit.window * 1000,
      };
      this.memoryStore.set(key, record);
    }

    record.count++;

    const allowed = record.count <= limit.requests;
    const remaining = Math.max(0, limit.requests - record.count);

    return { allowed, remaining, resetAt: record.resetAt };
  }

  private getClientIp(request: any): string {
    return (
      request.headers['x-forwarded-for']?.split(',')[0] ||
      request.headers['x-real-ip'] ||
      request.connection?.remoteAddress ||
      request.socket?.remoteAddress ||
      'unknown'
    );
  }
}
