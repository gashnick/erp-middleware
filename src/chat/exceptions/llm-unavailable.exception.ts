import { ServiceUnavailableException } from '@nestjs/common';

export class LLMUnavailableException extends ServiceUnavailableException {
  constructor(provider: string) {
    super(`LLM provider "${provider}" unavailable after retries.`);
  }
}
