import { LLMPrompt, LLMResponse } from '../chat.types';

export interface ILLMClient {
  complete(prompt: LLMPrompt): Promise<LLMResponse>;
}
