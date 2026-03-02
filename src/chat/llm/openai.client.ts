import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ILLMClient } from './llm-client.interface';
import { LLMPrompt, LLMResponse } from '../chat.types';

@Injectable()
export class OpenAIClient implements ILLMClient {
  private readonly logger = new Logger(OpenAIClient.name);
  private readonly apiKey: string;
  private readonly modelName: string;
  private readonly timeoutMs: number;

  constructor(private readonly config: ConfigService) {
    this.apiKey = config.get('OPENAI_API_KEY') ?? '';
    this.modelName = config.get('OPENAI_MODEL') ?? 'gpt-4.1-mini';
    this.timeoutMs = config.get<number>('AI_TIMEOUT_MS') ?? 30_000;
  }

  async complete(prompt: LLMPrompt): Promise<LLMResponse> {
    if (!this.apiKey) throw new Error('OPENAI_API_KEY is missing');

    const model = prompt.modelVersion ?? this.modelName;
    const start = Date.now();

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          input: [
            { role: 'system', content: prompt.systemPrompt },
            ...prompt.messages.map((m) => ({
              role: m.role as 'user' | 'assistant',
              content: m.text,
            })),
          ],
          max_output_tokens: 800,
          temperature: 0,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`OpenAI ${response.status} ${response.statusText}: ${errText}`);
      }

      const data = (await response.json()) as any;
      const text: string = data.output_text ?? '';

      return {
        text,
        provider: 'openai',
        model,
        promptTokens: data.usage?.input_tokens ?? 0,
        completionTokens: data.usage?.output_tokens ?? 0,
        latencyMs: Date.now() - start,
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}
