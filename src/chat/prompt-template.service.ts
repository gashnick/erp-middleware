// src/chat/prompt-template.service.ts
//
// Manages versioned prompt templates stored in the tenant schema.
//
// Versioning model:
//   - Each template name can have multiple versions (1, 2, 3...)
//   - Only one version per name can be active (is_active = true)
//   - getActive() returns the highest active version
//   - rollback() deactivates current version, activates previous one
//   - publish() creates a new version (auto-incremented) and activates it

import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { TenantQueryRunnerService } from '@database/tenant-query-runner.service';

export interface PromptTemplate {
  id: string;
  name: string;
  version: number;
  content: string;
  isActive: boolean;
  createdAt?: Date;
}

// ── Canonical templates — single source of truth ───────────────────────────
// When no template exists in the DB, or when placeholders are missing,
// this content is seeded as version 1.

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
    SELECT id, name, version, content, is_active AS "isActive", created_at AS "createdAt"
    FROM prompt_templates
    WHERE name = $1 AND is_active = true
    ORDER BY version DESC
    LIMIT 1
  `;

  private static readonly GET_PREVIOUS_SQL = `
    SELECT id, name, version, content, is_active AS "isActive", created_at AS "createdAt"
    FROM prompt_templates
    WHERE name = $1 AND is_active = false
    ORDER BY version DESC
    LIMIT 1
  `;

  private static readonly LIST_VERSIONS_SQL = `
    SELECT id, name, version, is_active AS "isActive", created_at AS "createdAt"
    FROM prompt_templates
    WHERE name = $1
    ORDER BY version DESC
  `;

  private static readonly MAX_VERSION_SQL = `
    SELECT COALESCE(MAX(version), 0) AS max_version
    FROM prompt_templates
    WHERE name = $1
  `;

  private static readonly DEACTIVATE_ALL_SQL = `
    UPDATE prompt_templates SET is_active = false WHERE name = $1
  `;

  private static readonly INSERT_VERSION_SQL = `
    INSERT INTO prompt_templates (name, version, content, is_active)
    VALUES ($1, $2, $3, true)
    RETURNING id, name, version, content, is_active AS "isActive", created_at AS "createdAt"
  `;

  private static readonly ACTIVATE_VERSION_SQL = `
    UPDATE prompt_templates SET is_active = true
    WHERE name = $1 AND version = $2
    RETURNING id, name, version, content, is_active AS "isActive", created_at AS "createdAt"
  `;

  constructor(private readonly tenantDb: TenantQueryRunnerService) {}

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Returns the active template for a given name.
   * Auto-seeds the canonical template if none exists or placeholders are missing.
   */
  async getActive(name: string): Promise<PromptTemplate> {
    const rows = await this.tenantDb.executeTenant<PromptTemplate>(
      PromptTemplateService.GET_ACTIVE_SQL,
      [name],
    );
    const template = rows[0];

    if (template && this.isMissingPlaceholders(name, template.content)) {
      this.logger.warn(`Template '${name}' v${template.version} missing placeholders — repairing`);
      return this.seedCanonical(name);
    }

    if (!template) {
      this.logger.warn(`No active template '${name}' — seeding canonical`);
      return this.seedCanonical(name);
    }

    return template;
  }

  /**
   * Renders a template by replacing {{placeholder}} tokens with values.
   */
  render(template: PromptTemplate, vars: Record<string, string>): string {
    return template.content.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? '');
  }

  /**
   * Lists all versions of a template (active and inactive).
   */
  async listVersions(name: string): Promise<Omit<PromptTemplate, 'content'>[]> {
    return this.tenantDb.executeTenant<Omit<PromptTemplate, 'content'>>(
      PromptTemplateService.LIST_VERSIONS_SQL,
      [name],
    );
  }

  /**
   * Publishes a new version of a template.
   * Deactivates the current active version and creates a new one with
   * an auto-incremented version number.
   */
  async publish(name: string, content: string): Promise<PromptTemplate> {
    return this.tenantDb.transaction(async (runner) => {
      // Get current max version
      const maxRows = await runner.query(PromptTemplateService.MAX_VERSION_SQL, [name]);
      const nextVersion = Number(maxRows[0]?.max_version ?? 0) + 1;

      // Deactivate all current versions
      await runner.query(PromptTemplateService.DEACTIVATE_ALL_SQL, [name]);

      // Insert new version as active
      const rows = await runner.query(PromptTemplateService.INSERT_VERSION_SQL, [
        name,
        nextVersion,
        content,
      ]);

      this.logger.log(`Template '${name}' published as v${nextVersion}`);
      return rows[0];
    });
  }

  /**
   * Rolls back to the previous inactive version.
   * Deactivates the current active version and activates the most recent inactive one.
   * Throws NotFoundException if there is no previous version to roll back to.
   */
  async rollback(name: string): Promise<PromptTemplate> {
    return this.tenantDb.transaction(async (runner) => {
      // Find current active version
      const activeRows = await runner.query(PromptTemplateService.GET_ACTIVE_SQL, [name]);
      const current = activeRows[0] as PromptTemplate | undefined;

      // Find previous inactive version
      const previousRows = await runner.query(PromptTemplateService.GET_PREVIOUS_SQL, [name]);
      const previous = previousRows[0] as PromptTemplate | undefined;

      if (!previous) {
        throw new NotFoundException(
          `No previous version found for template '${name}' to roll back to`,
        );
      }

      // Deactivate current
      await runner.query(PromptTemplateService.DEACTIVATE_ALL_SQL, [name]);

      // Activate previous
      const restoredRows = await runner.query(PromptTemplateService.ACTIVATE_VERSION_SQL, [
        name,
        previous.version,
      ]);

      this.logger.log(
        `Template '${name}' rolled back: v${current?.version ?? '?'} → v${previous.version}`,
      );
      return restoredRows[0];
    });
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private isMissingPlaceholders(name: string, content: string): boolean {
    const required = REQUIRED_PLACEHOLDERS[name];
    if (!required) return false;
    return required.some((p) => !content.includes(p));
  }

  private async seedCanonical(name: string): Promise<PromptTemplate> {
    const content = CANONICAL_TEMPLATES[name];
    if (!content) {
      return {
        id: 'default',
        name,
        version: 1,
        content: 'You are a helpful assistant.',
        isActive: true,
      };
    }
    try {
      return await this.publish(name, content);
    } catch (e) {
      this.logger.error(`Failed to seed canonical template '${name}': ${e.message}`);
      return { id: 'canonical', name, version: 1, content, isActive: true };
    }
  }
}
