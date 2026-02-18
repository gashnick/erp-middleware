export interface LLMProvider {
  generateResponse(prompt: string, context: any): Promise<LLMResponse>;
  validateResponse(response: string): boolean;
}

export interface LLMResponse {
  text: string;
  confidence: number;
  metadata?: Record<string, any>;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ContextData {
  tenantId: string;
  timeRange?: { start: Date; end: Date };
  entities?: string[];
  metrics?: Record<string, any>;
}
