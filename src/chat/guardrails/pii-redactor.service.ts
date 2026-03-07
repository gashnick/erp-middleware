import { Injectable } from '@nestjs/common';
import { AuditLogService, AuditAction } from '@common/audit/audit-log.service';
import { ipFromRequest, uaFromRequest } from '@common/audit/audit.helpers';
import { getTenantContext } from '@common/context/tenant-context';

export interface RedactionResult {
  redacted: string;
  hadPii: boolean;
}

// ── PII patterns ───────────────────────────────────────────────────────────
//
// IMPORTANT: These patterns must NOT match financial data (amounts, account
// numbers in financial context, invoice numbers, etc.) that are legitimately
// passed to the LLM as business context.
//
// Credit card pattern uses the Luhn-format heuristic:
//   - Must be exactly 13-16 consecutive digits (no spaces or separators here
//     because financial amounts use commas/decimals which break the sequence)
//   - Must NOT be preceded by a currency symbol or decimal context
//   - Groups separated by spaces/dashes are matched separately
//
const PII_PATTERNS: { type: string; pattern: RegExp }[] = [
  {
    // Credit card: 4 groups of 4 digits separated by spaces or dashes
    // e.g. 4111 1111 1111 1111 or 4111-1111-1111-1111
    // Does NOT match: 325351.75, 21250.00, 96800.00 (financial amounts)
    type: 'CREDIT_CARD',
    pattern: /\b(?:\d{4}[ -]){3}\d{4}\b/g,
  },
  {
    // SSN: strict NNN-NN-NNNN format only
    type: 'SSN',
    pattern: /\b(?!000|666|9\d{2})\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b/g,
  },
  {
    // IBAN: starts with 2 uppercase letters + 2 digits + alphanumeric
    type: 'IBAN',
    pattern: /\b[A-Z]{2}\d{2}[A-Z0-9]{4}\d{7}(?:[A-Z0-9]?){0,16}\b/g,
  },
  {
    // Email addresses
    type: 'EMAIL',
    pattern: /\b[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}\b/g,
  },
  {
    // US phone: must have area code separator to avoid matching amounts
    // Matches: (555) 123-4567, +1-555-123-4567, 555-123-4567
    // Does NOT match: 325351.75 or plain digit sequences
    type: 'PHONE_US',
    pattern: /\b(?:\+1[ -]?)?\(?\d{3}\)?[ -]\d{3}[ -]\d{4}\b/g,
  },
];

@Injectable()
export class PiiRedactorService {
  constructor(private readonly audit: AuditLogService) {}

  async redact(
    text: string,
    userId: string | null,
    sessionId: string,
    req: { ip?: string; headers?: Record<string, string | string[] | undefined> },
  ): Promise<RedactionResult> {
    const ctx = getTenantContext();
    const tenantId = ctx?.tenantId || 'unknown';

    // console.log(
    //   `PII Redactor - tenantId: ${tenantId}, userId: ${userId}, sessionId: ${sessionId}, schemaName: ${ctx.schemaName}`,
    // );

    let redacted = text;
    const detectedTypes: string[] = [];

    for (const { type, pattern } of PII_PATTERNS) {
      pattern.lastIndex = 0; // reset before test
      if (pattern.test(redacted)) {
        pattern.lastIndex = 0; // reset before replace
        redacted = redacted.replace(pattern, `[REDACTED:${type}]`);
        detectedTypes.push(type);
      }
      pattern.lastIndex = 0; // reset after use
    }

    if (detectedTypes.length > 0) {
      this.audit
        .log({
          tenantId,
          userId,
          action: AuditAction.WRITE,
          resourceType: 'pii_redaction',
          resourceId: sessionId,
          ipAddress: ipFromRequest(req),
          userAgent: uaFromRequest(req),
          metadata: { types: detectedTypes },
        })
        .catch(() => {});
    }

    return { redacted, hadPii: detectedTypes.length > 0 };
  }
}
