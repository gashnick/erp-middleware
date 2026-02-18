import { Injectable, Logger } from '@nestjs/common';
import { TenantQueryRunnerService } from '../../database/tenant-query-runner.service';
import { AIInsight } from '../entities/ai-insight.entity';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class AIInsightsService {
  private readonly logger = new Logger(AIInsightsService.name);

  constructor(private tenantQueryRunner: TenantQueryRunnerService) {}

  async saveInsight(
    tenantId: string,
    targetEntity: string,
    targetId: string,
    insightType: string,
    message: string,
    confidence: number,
    metadata?: Record<string, any>,
  ): Promise<AIInsight> {
    const query = `
      INSERT INTO ai_insights (
        id, tenant_id, target_entity, target_id, 
        insight_type, message, confidence, created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
      RETURNING *
    `;

    const id = uuidv4();
    const result = await this.tenantQueryRunner.executeQuery(tenantId, query, [
      id,
      tenantId,
      targetEntity,
      targetId,
      insightType,
      message,
      confidence,
    ]);

    this.logger.log(`Saved AI insight: ${insightType} for ${targetEntity}:${targetId}`);

    return {
      id: result[0].id,
      tenantId: result[0].tenant_id,
      targetEntity: result[0].target_entity,
      targetId: result[0].target_id,
      insightType: result[0].insight_type,
      message: result[0].message,
      confidence: parseFloat(result[0].confidence),
      metadata,
      createdAt: result[0].created_at,
    };
  }

  async getInsightsForEntity(
    tenantId: string,
    targetEntity: string,
    targetId: string,
  ): Promise<AIInsight[]> {
    const query = `
      SELECT * FROM ai_insights
      WHERE tenant_id = $1 
        AND target_entity = $2 
        AND target_id = $3
      ORDER BY created_at DESC
      LIMIT 50
    `;

    const results = await this.tenantQueryRunner.executeQuery(tenantId, query, [
      tenantId,
      targetEntity,
      targetId,
    ]);

    return results.map((row: any) => ({
      id: row.id,
      tenantId: row.tenant_id,
      targetEntity: row.target_entity,
      targetId: row.target_id,
      insightType: row.insight_type,
      message: row.message,
      confidence: parseFloat(row.confidence),
      createdAt: row.created_at,
    }));
  }

  async getRecentInsights(tenantId: string, limit: number = 20): Promise<AIInsight[]> {
    const query = `
      SELECT * FROM ai_insights
      WHERE tenant_id = $1
      ORDER BY created_at DESC
      LIMIT $2
    `;

    const results = await this.tenantQueryRunner.executeQuery(tenantId, query, [
      tenantId,
      limit,
    ]);

    return results.map((row: any) => ({
      id: row.id,
      tenantId: row.tenant_id,
      targetEntity: row.target_entity,
      targetId: row.target_id,
      insightType: row.insight_type,
      message: row.message,
      confidence: parseFloat(row.confidence),
      createdAt: row.created_at,
    }));
  }

  async getInsightsByType(
    tenantId: string,
    insightType: string,
    limit: number = 50,
  ): Promise<AIInsight[]> {
    const query = `
      SELECT * FROM ai_insights
      WHERE tenant_id = $1 
        AND insight_type = $2
      ORDER BY created_at DESC
      LIMIT $3
    `;

    const results = await this.tenantQueryRunner.executeQuery(tenantId, query, [
      tenantId,
      insightType,
      limit,
    ]);

    return results.map((row: any) => ({
      id: row.id,
      tenantId: row.tenant_id,
      targetEntity: row.target_entity,
      targetId: row.target_id,
      insightType: row.insight_type,
      message: row.message,
      confidence: parseFloat(row.confidence),
      createdAt: row.created_at,
    }));
  }
}
