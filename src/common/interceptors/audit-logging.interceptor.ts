// src/common/interceptors/audit-logging.interceptor.ts
import { Injectable, NestInterceptor, ExecutionContext, CallHandler, Logger } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { hasTenantContext, getTenantContext } from '../context/tenant-context';

/**
 * Audit Logging Interceptor
 *
 * Logs every request with tenant context for audit trail.
 *
 * Apply globally in main.ts:
 * ```typescript
 * app.useGlobalInterceptors(new AuditLoggingInterceptor());
 * ```
 */
@Injectable()
export class AuditLoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('Audit');

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const startTime = Date.now();

    // Extract tenant context if available
    let auditData: any = {
      method: request.method,
      path: request.path,
      ip: request.ip,
      userAgent: request.headers['user-agent'],
      timestamp: new Date().toISOString(),
    };

    if (hasTenantContext()) {
      const ctx = getTenantContext();
      auditData = {
        ...auditData,
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        requestId: ctx.requestId,
        schemaName: ctx.schemaName,
      };
    }

    return next.handle().pipe(
      tap({
        next: () => {
          const duration = Date.now() - startTime;
          this.logger.log(
            JSON.stringify({
              ...auditData,
              status: 'success',
              duration,
            }),
          );
        },
        error: (error) => {
          const duration = Date.now() - startTime;
          // 1. The "Easy Reading" log for you
          console.log(`🚀 [API] ${request.method} ${request.path} - ${duration}ms`);

          // 2. The "Structured Log" for the Month 1 Requirements
          this.logger.log(JSON.stringify({ ...auditData, status: 'success', duration }));
        },
      }),
    );
  }
}
