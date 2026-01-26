import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionsHandler');

  catch(exception: any, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    // Determine status: Use the status if it's an HttpException, otherwise 500
    const status =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

    const message =
      exception instanceof HttpException
        ? exception.getResponse()
        : exception.message || 'Internal server error';

    // LOGGING: This is what helps you solve the E2E test
    // It prints the exact line number and cause of the 500 error
    this.logger.error(
      `Http Status: ${status} | Method: ${request.method} | URL: ${request.url}`,
      exception.stack, // This is the crucial bit for debugging
    );

    response.status(status).json({
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      // Hide stack trace from client in production, show it in development/test
      message: process.env.NODE_ENV === 'production' ? 'Internal server error' : message,
    });
  }
}
