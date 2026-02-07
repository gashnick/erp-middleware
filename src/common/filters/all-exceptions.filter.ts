import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { getTenantContext, hasTenantContext } from '@common/context/tenant-context';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('AllExceptionsFilter');

  catch(exception: any, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    // 1. Extract context safely to include in logs and response
    const tenantCtx = hasTenantContext() ? getTenantContext() : null;
    const correlationId = tenantCtx?.requestId || 'system-init';

    // 2. Determine normalized status code
    const status =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

    // 3. Extract the error message
    const exceptionResponse = exception instanceof HttpException ? exception.getResponse() : null;
    const message = exceptionResponse
      ? typeof exceptionResponse === 'object'
        ? (exceptionResponse as any).message
        : exceptionResponse
      : exception.message || 'Internal server error';

    // 4. SMART LOGGING
    // We log the full stack trace for 500 errors to help with debugging,
    // but keep 4xx errors concise to avoid log bloat.
    const logPayload = {
      method: request.method,
      url: request.url,
      tenantId: tenantCtx?.tenantId || 'N/A',
      schemaName: tenantCtx?.schemaName || 'public',
      correlationId,
    };

    if (status >= 500) {
      this.logger.error(
        `[${correlationId}] Critical Error: ${JSON.stringify(logPayload)}`,
        exception.stack,
      );
    } else {
      this.logger.warn(
        `[${correlationId}] Client Error: ${status} | ${request.method} ${request.url} | Message: ${JSON.stringify(message)}`,
      );
    }

    // 5. CLEAN RESPONSE
    // Mask sensitive details in production, but provide the correlationId
    // so the user can report the exact error to support.
    const isProduction = process.env.NODE_ENV === 'production';

    response.status(status).json({
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      correlationId: correlationId,
      message:
        status >= 500 && isProduction
          ? 'A system error occurred. Please contact support.'
          : message,
      // Optional: helpful for E2E tests to see the error type
      error: !isProduction && exception.name ? exception.name : undefined,
    });
  }
}
