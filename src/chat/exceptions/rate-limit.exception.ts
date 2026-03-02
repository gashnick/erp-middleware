import { HttpException, HttpStatus } from '@nestjs/common';

export class RateLimitException extends HttpException {
  constructor(retryAfterMs: number) {
    super(
      { code: 'RATE_LIMITED', message: 'Rate limit exceeded', retryAfterMs },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
