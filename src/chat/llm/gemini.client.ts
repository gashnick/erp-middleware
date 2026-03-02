import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ILLMClient } from './llm-client.interface';
import { LLMPrompt, LLMResponse } from '../chat.types';

@Injectable()
export class GeminiClient implements ILLMClient {
  private readonly logger = new Logger(GeminiClient.name);
  private readonly apiKey: string;
  private readonly modelName: string;
  private readonly timeoutMs: number;

  constructor(private readonly config: ConfigService) {
    this.apiKey = config.get('GEMINI_API_KEY') ?? '';
    this.modelName = config.get('GEMINI_MODEL') ?? 'gemini-2.5-flash';
    this.timeoutMs = config.get<number>('AI_TIMEOUT_MS') ?? 30_000;
  }

  async complete(prompt: LLMPrompt): Promise<LLMResponse> {
    if (!this.apiKey) throw new Error('GEMINI_API_KEY is missing');

    const model = prompt.modelVersion ?? this.modelName;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.apiKey}`;
    const start = Date.now();

    // Gemini doesn't have a system role — inject system prompt as a
    // user/model exchange at the top of the conversation history.
    const contents = [
      ...(prompt.systemPrompt
        ? [
            { role: 'user', parts: [{ text: prompt.systemPrompt }] },
            { role: 'model', parts: [{ text: 'Understood.' }] },
          ]
        : []),
      ...prompt.messages.map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.text }],
      })),
    ];

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents,
          generationConfig: { temperature: 0.2 },
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Gemini ${response.status} ${response.statusText}: ${errText}`);
      }

      const data = (await response.json()) as any;
      const text: string = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';

      return {
        text,
        provider: 'gemini',
        model,
        promptTokens: data.usageMetadata?.promptTokenCount ?? 0,
        completionTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
        latencyMs: Date.now() - start,
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}
