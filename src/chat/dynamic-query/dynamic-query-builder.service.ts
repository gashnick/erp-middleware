// src/chat/dynamic-query/dynamic-query-builder.service.ts
//
// Builds and executes safe, parameterized SQL queries from the QueryTemplate
// registry. This service is the only place where SQL touches the database —
// and it never interpolates anything from user input into a query string.
//
// Security guarantees:
//  • Table name is validated against ALLOWED_TABLES whitelist before use.
//  • Column names are validated against the template's allowedColumns before use.
//  • All values are passed as bind parameters ($1, $2, …) — never concatenated.
//  • The aggregation SQL is a hardcoded string from the registry, not user input.
//  • Results are capped at template.maxRows — no unbounded scans.

import { Injectable, Logger } from '@nestjs/common';
import { TenantQueryRunnerService } from '@database/tenant-query-runner.service';
import { QueryIntent, QueryTemplate, QUERY_TEMPLATES, ALLOWED_TABLES } from './table-registry';

export interface QueryResult {
  intent: QueryIntent;
  table: string;
  rows: Record<string, unknown>[];
  rowCount: number;
  executedAt: Date;
}

@Injectable()
export class DynamicQueryBuilderService {
  private readonly logger = new Logger(DynamicQueryBuilderService.name);

  constructor(private readonly tenantDb: TenantQueryRunnerService) {}

  /**
   * Executes the predefined query for a given intent.
   * Optional params override the template's defaultParams.
   */
  async execute(
    intent: QueryIntent,
    overrideParams?: (string | number | Date)[],
  ): Promise<QueryResult> {
    const template = QUERY_TEMPLATES[intent];
    if (!template) {
      throw new Error(`Unknown intent: ${intent}`);
    }

    this.assertTableAllowed(template.table);

    const params = overrideParams ?? template.defaultParams ?? [];
    const sql = this.buildSql(template);

    this.logger.debug(`[${intent}] Executing query on table: ${template.table}`);

    const rows = await this.tenantDb.executeTenant<Record<string, unknown>>(sql, params);

    // Hard cap — never return more rows than the template allows
    const capped = rows.slice(0, template.maxRows);

    return {
      intent,
      table: template.table,
      rows: capped,
      rowCount: capped.length,
      executedAt: new Date(),
    };
  }

  /**
   * Executes multiple intents concurrently.
   * Failed intents are logged and excluded — one bad query never blocks others.
   */
  async executeMany(
    intents: QueryIntent[],
    overrideParams?: Partial<Record<QueryIntent, (string | number | Date)[]>>,
  ): Promise<QueryResult[]> {
    const settled = await Promise.allSettled(
      intents.map((intent) => this.execute(intent, overrideParams?.[intent])),
    );

    const results: QueryResult[] = [];
    for (const [i, outcome] of settled.entries()) {
      if (outcome.status === 'fulfilled') {
        results.push(outcome.value);
      } else {
        this.logger.warn(`Intent '${intents[i]}' failed: ${outcome.reason?.message}`);
      }
    }
    return results;
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  /**
   * Returns the aggregation SQL from the template.
   * This is a hardcoded string — never constructed from user input.
   */
  private buildSql(template: QueryTemplate): string {
    if (!template.aggregation) {
      // Fallback: simple SELECT of allowed columns with row cap
      const cols = template.allowedColumns
        .map((c) => (c.alias ? `${c.name} AS ${c.alias}` : c.name))
        .join(', ');
      return `SELECT ${cols} FROM ${template.table} LIMIT ${template.maxRows}`;
    }
    // Trim whitespace from the predefined aggregation SQL
    return template.aggregation.trim();
  }

  /**
   * Rejects any table name not in the ALLOWED_TABLES whitelist.
   * This is a defence-in-depth check — the registry should already guarantee
   * correctness, but we validate again at execution time.
   */
  private assertTableAllowed(table: string): void {
    if (!ALLOWED_TABLES.has(table)) {
      throw new Error(
        `Security violation: table '${table}' is not in the allowed tables whitelist`,
      );
    }
  }

  /**
   * Validates that a column name exists in the template's allowedColumns.
   * Used by callers that need to verify user-supplied filter column names.
   */
  assertColumnAllowed(intent: QueryIntent, columnName: string): void {
    const template = QUERY_TEMPLATES[intent];
    const allowed = template?.allowedColumns.some(
      (c) => c.name === columnName || c.alias === columnName,
    );
    if (!allowed) {
      throw new Error(
        `Security violation: column '${columnName}' is not allowed for intent '${intent}'`,
      );
    }
  }
}
