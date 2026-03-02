export type MessageRole = 'user' | 'assistant' | 'system';

export interface TextContent {
  type: 'text';
  text: string;
}
export interface ChartContent {
  type: 'chart';
  spec: object;
}
export interface TableContent {
  type: 'table';
  columns: string[];
  rows: unknown[][];
}
export interface CsvContent {
  type: 'csv';
  url: string;
  filename: string;
}
export interface LinkContent {
  type: 'link';
  url: string;
  label: string;
}

export type MessageContent = TextContent | ChartContent | TableContent | CsvContent | LinkContent;

export interface ChatMessage {
  id: string;
  sessionId: string;
  role: MessageRole;
  content: MessageContent;
  latencyMs?: number;
  createdAt: Date;
}

export interface ChatSession {
  id: string;
  tenantId: string;
  userId: string;
  messages: ChatMessage[];
  createdAt: Date;
}

export interface LLMPrompt {
  systemPrompt: string;
  messages: { role: MessageRole; text: string }[];
  modelVersion?: string;
}

export interface LLMResponse {
  text: string;
  provider: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  latencyMs: number;
}

export interface ContextBundle {
  kpiSummary: string;
  anomalySummary: string;
  entityRefs: string[];
  tokenCount: number;
}
