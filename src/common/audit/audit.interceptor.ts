import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { AuditLogService, AuditAction } from './audit-log.service';

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private auditLogService: AuditLogService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const { method, url, user, ip, headers } = request;

    // Determine action from HTTP method
    const action = this.mapMethodToAction(method);

    // Extract resource info from URL
    const { resourceType, resourceId } = this.parseResource(url);

    // Skip audit for health checks and non-sensitive endpoints
    if (this.shouldSkipAudit(url)) {
      return next.handle();
    }

    return next.handle().pipe(
      tap({
        next: () => {
          // Log successful operation
          this.auditLogService.log({
            tenantId: user?.tenantId || null,
            userId: user?.sub || null,
            action,
            resourceType,
            resourceId,
            ipAddress: ip || headers['x-forwarded-for'] || 'unknown',
            userAgent: headers['user-agent'] || 'unknown',
            metadata: {
              method,
              url,
              statusCode: 200,
            },
          });
        },
        error: (error) => {
          // Log failed operation
          this.auditLogService.log({
            tenantId: user?.tenantId || null,
            userId: user?.sub || null,
            action,
            resourceType,
            resourceId,
            ipAddress: ip || headers['x-forwarded-for'] || 'unknown',
            userAgent: headers['user-agent'] || 'unknown',
            metadata: {
              method,
              url,
              statusCode: error.status || 500,
              error: error.message,
            },
          });
        },
      })
    );
  }

  private mapMethodToAction(method: string): AuditAction {
    switch (method.toUpperCase()) {
      case 'GET':
        return AuditAction.READ;
      case 'POST':
      case 'PUT':
      case 'PATCH':
        return AuditAction.WRITE;
      case 'DELETE':
        return AuditAction.DELETE;
      default:
        return AuditAction.READ;
    }
  }

  private parseResource(url: string): { resourceType: string; resourceId: string | null } {
    // Parse URL to extract resource type and ID
    // Example: /api/invoices/123 -> { resourceType: 'invoices', resourceId: '123' }
    const parts = url.split('/').filter(Boolean);

    if (parts.length >= 3) {
      return {
        resourceType: parts[2], // Skip 'api'
        resourceId: parts[3] || null,
      };
    }

    return {
      resourceType: parts[parts.length - 1] || 'unknown',
      resourceId: null,
    };
  }

  private shouldSkipAudit(url: string): boolean {
    const skipPatterns = [
      '/health',
      '/metrics',
      '/api/docs',
      '/swagger',
    ];

    return skipPatterns.some(pattern => url.includes(pattern));
  }
}
