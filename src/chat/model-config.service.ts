// src/chat/model-config.service.ts
//
// Manages per-tenant model overrides stored in the model_configs table.
//
// Resolution order for active model:
//   1. Active row in model_configs for the requested provider
//   2. Environment variable (OPENAI_MODEL / GEMINI_MODEL)
//   3. Hard-coded default per provider
//
// This means a model can be overridden at runtime (no deploy needed)
// and rolled back by deactivating the current config row.

import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TenantQueryRunnerService } from '@database/tenant-query-runner.service';

export type LLMProvider = 'openai' | 'gemini';

export interface ModelConfig {
  id: string;
  provider: LLMProvider;
  modelName: string;
  isActive: boolean;
  notes?: string;
  createdAt: Date;
}

const PROVIDER_DEFAULTS: Record<LLMProvider, string> = {
  openai: 'gpt-4.1-mini',
  gemini: 'gemini-2.5-flash',
};

const PROVIDER_ENV_KEYS: Record<LLMProvider, string> = {
  openai: 'OPENAI_MODEL',
  gemini: 'GEMINI_MODEL',
};

@Injectable()
export class ModelConfigService {
  private readonly logger = new Logger(ModelConfigService.name);

  private static readonly GET_ACTIVE_SQL = `
    SELECT
      id,
      provider,
      model_name  AS "modelName",
      is_active   AS "isActive",
      notes,
      created_at  AS "createdAt"
    FROM model_configs
    WHERE provider = $1 AND is_active = true
    LIMIT 1
  `;

  private static readonly LIST_SQL = `
    SELECT
      id,
      provider,
      model_name  AS "modelName",
      is_active   AS "isActive",
      notes,
      created_at  AS "createdAt"
    FROM model_configs
    WHERE provider = $1
    ORDER BY created_at DESC
    LIMIT 20
  `;

  private static readonly DEACTIVATE_ALL_SQL = `
    UPDATE model_configs
    SET is_active = false
    WHERE provider = $1
  `;

  private static readonly INSERT_SQL = `
    INSERT INTO model_configs (provider, model_name, is_active, notes)
    VALUES ($1, $2, true, $3)
    RETURNING
      id,
      provider,
      model_name  AS "modelName",
      is_active   AS "isActive",
      notes,
      created_at  AS "createdAt"
  `;

  private static readonly DEACTIVATE_ONE_SQL = `
    UPDATE model_configs
    SET is_active = false
    WHERE id = $1
    RETURNING id
  `;

  constructor(
    private readonly tenantDb: TenantQueryRunnerService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Returns the active model name for a provider.
   * Falls back to env var then hard-coded default if no DB override exists.
   */
  async getActiveModel(provider: LLMProvider): Promise<string> {
    try {
      const rows = await this.tenantDb.executeTenant<ModelConfig>(
        ModelConfigService.GET_ACTIVE_SQL,
        [provider],
      );
      if (rows[0]?.modelName) {
        this.logger.debug(`Model override active: provider=${provider} model=${rows[0].modelName}`);
        return rows[0].modelName;
      }
    } catch (err) {
      // Non-fatal — fall through to env var
      this.logger.warn(`Could not read model_configs (${err.message}) — using env var`);
    }

    // Fallback to env var then default
    const envModel = this.config.get<string>(PROVIDER_ENV_KEYS[provider]);
    return envModel ?? PROVIDER_DEFAULTS[provider];
  }

  /**
   * Lists all model configs for a provider, most recent first.
   */
  async list(provider: LLMProvider): Promise<ModelConfig[]> {
    return this.tenantDb.executeTenant<ModelConfig>(ModelConfigService.LIST_SQL, [provider]);
  }

  /**
   * Sets a new active model for a provider.
   * Deactivates the current active config first (only one active per provider).
   */
  async setActiveModel(
    provider: LLMProvider,
    modelName: string,
    notes?: string,
  ): Promise<ModelConfig> {
    return this.tenantDb.transaction(async (runner) => {
      // Deactivate current active config
      await runner.query(ModelConfigService.DEACTIVATE_ALL_SQL, [provider]);

      // Insert new active config
      const rows = await runner.query(ModelConfigService.INSERT_SQL, [
        provider,
        modelName,
        notes ?? null,
      ]);

      this.logger.log(`Model override set: provider=${provider} model=${modelName}`);
      return rows[0];
    });
  }

  /**
   * Rolls back to the previous model config for a provider.
   * Deactivates the current active config and activates the most recent inactive one.
   * Throws NotFoundException if there is no previous config to roll back to.
   */
  async rollback(provider: LLMProvider): Promise<ModelConfig> {
    return this.tenantDb.transaction(async (runner) => {
      // Find current active config
      const activeRows = await runner.query(
        `SELECT id, model_name AS "modelName"
         FROM model_configs
         WHERE provider = $1 AND is_active = true
         LIMIT 1`,
        [provider],
      );

      const current = activeRows[0];

      // Find the most recent inactive config to roll back to
      const previousRows = await runner.query(
        `SELECT id, model_name AS "modelName"
         FROM model_configs
         WHERE provider = $1
           AND is_active = false
           ${current ? `AND id != '${current.id}'` : ''}
         ORDER BY created_at DESC
         LIMIT 1`,
        [provider],
      );

      const previous = previousRows[0];
      if (!previous) {
        throw new NotFoundException(
          `No previous model config found for provider '${provider}' to roll back to`,
        );
      }

      // Deactivate current
      if (current) {
        await runner.query(ModelConfigService.DEACTIVATE_ONE_SQL, [current.id]);
      }

      // Activate previous
      const restoredRows = await runner.query(
        `UPDATE model_configs
         SET is_active = true
         WHERE id = $1
         RETURNING
           id, provider,
           model_name AS "modelName",
           is_active  AS "isActive",
           notes,
           created_at AS "createdAt"`,
        [previous.id],
      );

      this.logger.log(
        `Model rolled back: provider=${provider} ` +
          `from=${current?.modelName ?? 'none'} to=${previous.modelName}`,
      );

      return restoredRows[0];
    });
  }
}
