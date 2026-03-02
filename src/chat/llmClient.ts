import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OpenAIClient } from './llm/openai.client';
import { GeminiClient } from './llm/gemini.client';
import { LLMPrompt, LLMResponse } from './chat.types';

@Injectable()
export class LLMClientFactory {
  private readonly client: OpenAIClient | GeminiClient;

  constructor(
    config: ConfigService,
    private readonly openai: OpenAIClient,
    private readonly gemini: GeminiClient,
  ) {
    // Default is gemini. Set LLM_PROVIDER=openai in .env to switch.
    this.client = config.get('LLM_PROVIDER') === 'openai' ? openai : gemini;
  }

  async complete(prompt: LLMPrompt, maxAttempts = 3): Promise<LLMResponse> {
    let lastErr: Error | undefined;
    for (let i = 1; i <= maxAttempts; i++) {
      try {
        return await this.client.complete(prompt);
      } catch (err) {
        lastErr = err as Error;
        await new Promise((r) => setTimeout(r, 200 * 2 ** (i - 1)));
      }
    }
    throw new ServiceUnavailableException(`LLM unavailable: ${lastErr?.message}`);
  }
}
