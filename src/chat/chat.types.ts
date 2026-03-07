// src/chat/chat.types.ts

export type MessageRole = 'user' | 'assistant' | 'system';

// ── Message content variants ───────────────────────────────────────────────

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

// ── Structured response envelope ───────────────────────────────────────────
//
// The AI always returns a text answer. Supplementary charts/tables/links are
// derived from query data already in memory — no extra DB calls needed.

export interface ChartSpec {
  type: 'bar' | 'line' | 'area' | 'point';
  title: string;
  xField: string;
  xLabel: string;
  yField: string;
  yLabel: string;
  data: Record<string, unknown>[];
}

export interface TableSpec {
  title: string;
  headers: string[];
  rows: (string | number | null)[][];
}

export interface LinkSpec {
  label: string;
  url: string;
  description?: string;
}

export interface StructuredResponse {
  text: string;
  charts: ChartSpec[];
  tables: TableSpec[];
  links: LinkSpec[];
}

// ── Chat entities ──────────────────────────────────────────────────────────

export interface ChatMessage {
  id: string;
  sessionId: string;
  role: MessageRole;
  content: MessageContent;
  structured?: StructuredResponse;
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

// ── Context bundle ─────────────────────────────────────────────────────────
//
// QueryResult is imported here to avoid a circular dependency — chat.types
// imports from dynamic-query, not the other way around.

import { QueryResult } from './dynamic-query/dynamic-query-builder.service';

export interface ContextBundle {
  kpiSummary: string;
  anomalySummary: string;
  entityGraph: string; // ← add this
  entityRefs: string[];
  tokenCount: number;
  queryResults: QueryResult[];
}
