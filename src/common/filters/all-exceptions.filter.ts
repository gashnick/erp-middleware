import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { GqlArgumentsHost } from '@nestjs/graphql';
import { getTenantContext, hasTenantContext } from '@common/context/tenant-context';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('AllExceptionsFilter');

  catch(exception: any, host: ArgumentsHost) {
    const contextType = host.getType<'http' | 'graphql'>();

    // 1. Extract context safely for logging
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

    const isProduction = process.env.NODE_ENV === 'production';

    // ── GraphQL context ────────────────────────────────────────────────────────
    // Apollo handles response formatting — we must NOT touch the HTTP response.
    // Just log and rethrow so Apollo formats the error correctly for the client.
    if (contextType === 'graphql') {
      const gqlHost = GqlArgumentsHost.create(host);
      const ctx = gqlHost.getContext();
      const req = ctx?.req || ctx?.request;

      const logPayload = {
        method: req?.method || 'POST',
        url: req?.url || '/graphql',
        tenantId: tenantCtx?.tenantId || 'N/A',
        schemaName: tenantCtx?.schemaName || 'public',
        correlationId,
      };

      if (status >= 500) {
        this.logger.error(
          `[${correlationId}] GraphQL Critical Error: ${JSON.stringify(logPayload)}`,
          exception.stack,
        );
      } else {
        this.logger.warn(
          `[${correlationId}] GraphQL Client Error: ${status} | ${JSON.stringify(message)}`,
        );
      }

      // Rethrow — Apollo will catch this and format it into the errors[] array.
      // Masking in production so we don't leak internals to GraphQL clients.
      if (status >= 500 && isProduction) {
        throw new Error('A system error occurred. Please contact support.');
      }
      throw exception;
    }

    // ── HTTP context ───────────────────────────────────────────────────────────
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    let request: any = ctx.getRequest<Request>();

    if (!request) {
      request = { method: 'N/A', url: 'N/A' };
    }

    const logPayload = {
      method: request?.method || 'N/A',
      url: request?.url || request?.path || 'N/A',
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
        `[${correlationId}] Client Error: ${status} | ${logPayload.method} ${logPayload.url} | Message: ${JSON.stringify(message)}`,
      );
    }

    response.status(status).json({
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      correlationId,
      message:
        status >= 500 && isProduction
          ? 'A system error occurred. Please contact support.'
          : message,
      error: !isProduction && exception.name ? exception.name : undefined,
    });
  }
}
