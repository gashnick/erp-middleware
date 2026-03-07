// src/chat/prompt-template.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { TenantQueryRunnerService } from '@database/tenant-query-runner.service';

export interface PromptTemplate {
  id: string;
  name: string;
  content: string;
  isActive: boolean;
}

const CANONICAL_TEMPLATES: Record<string, string> = {
  finance_chat: `You are a helpful financial assistant for an ERP system.
You have access to the following REAL financial data for this tenant. This data comes directly from their invoices, bank transactions, and expense records.

=== KPI SUMMARY ===
{{kpiSummary}}

=== RECENT ANOMALIES ===
{{anomalySummary}}

=== RELATED ENTITIES ===
{{entityGraph}}

INSTRUCTIONS:
- Answer questions using ONLY the data shown above.
- Always cite specific figures when answering (e.g. "Based on your invoices, revenue in Nov 2025 was USD 96,800").
- When entities are listed in RELATED ENTITIES, use them to ground your answer — reference vendor names, invoice numbers, and spend totals directly.
- Never say you lack access to financial data — the KPI Summary above IS your data source.
- If a specific metric is not present in the data above, say it is not available in the current dataset.
- If anomalies are listed, proactively flag them when relevant.
- Be concise and professional.`,
};

const REQUIRED_PLACEHOLDERS: Record<string, string[]> = {
  finance_chat: ['{{kpiSummary}}', '{{anomalySummary}}', '{{entityGraph}}'],
};

@Injectable()
export class PromptTemplateService {
  private readonly logger = new Logger(PromptTemplateService.name);

  private static readonly GET_ACTIVE_SQL = `
    SELECT id, name, content, is_active AS "isActive"
    FROM prompt_templates
    WHERE name = $1 AND is_active = true
    LIMIT 1
  `;

  private static readonly UPSERT_SQL = `
    INSERT INTO prompt_templates (name, content, is_active)
    VALUES ($1, $2, true)
    ON CONFLICT (name) DO UPDATE SET content = EXCLUDED.content, is_active = true
  `;

  constructor(private readonly tenantDb: TenantQueryRunnerService) {}

  async getActive(name: string): Promise<PromptTemplate> {
    const rows = await this.tenantDb.executeTenant<PromptTemplate>(
      PromptTemplateService.GET_ACTIVE_SQL,
      [name],
    );
    const template = rows[0];

    if (template && this.isMissingPlaceholders(name, template.content)) {
      this.logger.warn(`Template '${name}' missing placeholders — auto-repairing`);
      return this.upsertCanonical(name);
    }
    if (!template) {
      this.logger.warn(`No active template '${name}' — seeding canonical`);
      return this.upsertCanonical(name);
    }
    return template;
  }

  render(template: PromptTemplate, vars: Record<string, string>): string {
    return template.content.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? '');
  }

  private isMissingPlaceholders(name: string, content: string): boolean {
    const required = REQUIRED_PLACEHOLDERS[name];
    if (!required) return false;
    return required.some((p) => !content.includes(p));
  }

  private async upsertCanonical(name: string): Promise<PromptTemplate> {
    const content = CANONICAL_TEMPLATES[name];
    if (!content) {
      return { id: 'default', name, content: 'You are a helpful assistant.', isActive: true };
    }
    try {
      await this.tenantDb.executeTenant(PromptTemplateService.UPSERT_SQL, [name, content]);
      this.logger.log(`Canonical template '${name}' upserted`);
    } catch (e) {
      this.logger.error(`Failed to upsert template '${name}': ${e.message}`);
    }
    return { id: 'canonical', name, content, isActive: true };
  }
}
