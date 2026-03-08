// src/chat/guardrails/response-validator.service.ts
//
// Validates LLM output before it reaches the formatter or gets persisted.
//
// Checks (in order):
//   1. Empty / too short    — likely a failed generation, throw
//   2. Prompt injection echo — model leaked the system prompt template
//   3. Refusal hallucination — model says it can't see data when context was injected
//   4. Runaway length        — truncate with a notice rather than returning walls of text
//   5. Off-topic             — no financial terms in response to a financial question (warn only)
//
// All checks are configurable via environment variables so they can be
// tuned without code changes:
//   RESPONSE_MIN_LENGTH     (default: 20)
//   RESPONSE_MAX_LENGTH     (default: 3000)
//
// The service never throws for soft failures (off-topic, length) — it
// returns a ValidationResult so ChatService decides how to handle each case.

import { Injectable, Logger, BadGatewayException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface ValidationResult {
  valid: boolean;
  text: string; // Possibly modified (truncated, fallback replaced)
  warnings: string[]; // Non-fatal issues logged to audit
}

// ── Refusal phrases ────────────────────────────────────────────────────────
// These indicate the LLM is refusing to use the injected context.
// We replace the response with a structured fallback rather than returning
// a confusing "I don't have access" message to the user.

const REFUSAL_PATTERNS = [
  /i (don'?t|do not|cannot|can'?t) have access to/i,
  /i (don'?t|do not|cannot|can'?t) see your (data|records|financials)/i,
  /no (financial |)data (is |)available to me/i,
  /i('?m| am) not able to access/i,
  /as an ai (language model|assistant),? i (don'?t|cannot)/i,
  /i don'?t have (real-?time|current|live) (access|data)/i,
];

// ── Prompt injection signals ───────────────────────────────────────────────
// If the model echoes back prompt structure, something went wrong upstream.

const INJECTION_PATTERNS = [
  /^\s*SYSTEM:/im,
  /^\s*\{\{/m, // leaked template placeholder
  /===\s*KPI SUMMARY\s*===/i, // leaked section header
  /===\s*RECENT ANOMALIES\s*===/i,
];

// ── Financial domain terms ─────────────────────────────────────────────────
// At least one of these should appear in a valid finance assistant response.

const FINANCIAL_TERMS = [
  'invoice',
  'revenue',
  'expense',
  'cash',
  'payment',
  'balance',
  'transaction',
  'amount',
  'usd',
  'currency',
  'vendor',
  'anomaly',
  'profit',
  'cost',
  'budget',
  'financial',
  'fiscal',
  'bank',
  'overdue',
  'credit',
  'debit',
  'spend',
  'spending',
];

const REFUSAL_FALLBACK =
  'Based on the financial data available for your account, I can help answer questions ' +
  'about your invoices, expenses, cash position, and detected anomalies. ' +
  'Please ask a specific question about your financial data.';

@Injectable()
export class ResponseValidatorService {
  private readonly logger = new Logger(ResponseValidatorService.name);
  private readonly minLength: number;
  private readonly maxLength: number;

  constructor(private readonly config: ConfigService) {
    this.minLength = config.get<number>('RESPONSE_MIN_LENGTH') ?? 20;
    this.maxLength = config.get<number>('RESPONSE_MAX_LENGTH') ?? 3000;
  }

  /**
   * Validates and optionally repairs the LLM response text.
   *
   * @param text          — raw LLM output after PII redaction
   * @param userQuestion  — original question (used for off-topic check)
   * @throws BadGatewayException for hard failures (empty, injection detected)
   */
  validate(text: string, userQuestion: string): ValidationResult {
    const warnings: string[] = [];
    let output = text.trim();

    // ── Check 1: Empty / too short ─────────────────────────────────────────
    if (output.length < this.minLength) {
      this.logger.error(`LLM response too short (${output.length} chars) — rejecting`);
      throw new BadGatewayException('The AI returned an incomplete response. Please try again.');
    }

    // ── Check 2: Prompt injection echo ────────────────────────────────────
    // Hard failure — something is wrong with the prompt pipeline
    for (const pattern of INJECTION_PATTERNS) {
      if (pattern.test(output)) {
        this.logger.error(`Prompt injection echo detected — pattern: ${pattern}`);
        throw new BadGatewayException(
          'The AI response contained unexpected content. Please try again.',
        );
      }
    }

    // ── Check 3: Refusal hallucination ────────────────────────────────────
    // Soft failure — replace with helpful fallback rather than confusing user
    for (const pattern of REFUSAL_PATTERNS) {
      if (pattern.test(output)) {
        this.logger.warn(
          `Refusal hallucination detected — pattern: ${pattern} — replacing with fallback`,
        );
        warnings.push('REFUSAL_HALLUCINATION');
        output = REFUSAL_FALLBACK;
        break; // One replacement is enough
      }
    }

    // ── Check 4: Runaway length ───────────────────────────────────────────
    // Truncate at sentence boundary near the limit rather than hard-cutting
    if (output.length > this.maxLength) {
      this.logger.warn(
        `LLM response too long (${output.length} chars) — truncating to ${this.maxLength}`,
      );
      warnings.push('RESPONSE_TRUNCATED');

      // Find the last sentence boundary before the limit
      const truncated = output.slice(0, this.maxLength);
      const lastPeriod = Math.max(truncated.lastIndexOf('. '), truncated.lastIndexOf('.\n'));
      output =
        (lastPeriod > this.maxLength * 0.7 ? truncated.slice(0, lastPeriod + 1) : truncated) +
        ' [Response truncated]';
    }

    // ── Check 5: Off-topic (warn only) ────────────────────────────────────
    // Finance assistant should mention at least one financial term.
    // We only flag this — never block — because the LLM may legitimately
    // give a short contextual answer without explicit financial vocabulary.
    const lowerOutput = output.toLowerCase();
    const hasFinancialTerm = FINANCIAL_TERMS.some((term) => lowerOutput.includes(term));

    if (!hasFinancialTerm) {
      this.logger.warn(`Off-topic response detected for question: "${userQuestion.slice(0, 60)}"`);
      warnings.push('OFF_TOPIC');
    }

    return { valid: true, text: output, warnings };
  }
}
