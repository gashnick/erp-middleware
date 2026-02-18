import { Injectable, Logger, Scope } from '@nestjs/common';

export interface LogContext {
  tenantId?: string;
  userId?: string;
  requestId?: string;
  correlationId?: string;
  [key: string]: any;
}

@Injectable({ scope: Scope.TRANSIENT })
export class StructuredLogger {
  private context: LogContext = {};
  private readonly logger: Logger;

  constructor(private readonly loggerContext: string) {
    this.logger = new Logger(loggerContext);
  }

  setContext(context: Partial<LogContext>): void {
    this.context = { ...this.context, ...context };
  }

  log(message: string, additionalContext?: Record<string, any>): void {
    this.logger.log(this.formatMessage(message, additionalContext));
  }

  error(message: string, trace?: string, additionalContext?: Record<string, any>): void {
    this.logger.error(this.formatMessage(message, additionalContext), trace);
  }

  warn(message: string, additionalContext?: Record<string, any>): void {
    this.logger.warn(this.formatMessage(message, additionalContext));
  }

  debug(message: string, additionalContext?: Record<string, any>): void {
    this.logger.debug(this.formatMessage(message, additionalContext));
  }

  private formatMessage(message: string, additionalContext?: Record<string, any>): string {
    const fullContext = { ...this.context, ...additionalContext };
    
    return JSON.stringify({
      timestamp: new Date().toISOString(),
      message,
      ...fullContext,
    });
  }
}
