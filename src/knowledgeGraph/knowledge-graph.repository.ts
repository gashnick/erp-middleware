import { Injectable } from '@nestjs/common';
import { TenantQueryRunnerService } from '@database/tenant-query-runner.service';
import { KGEntity, KGRelationship, EntityType, RelationshipType } from './knowledge-graph.types';

@Injectable()
export class KnowledgeGraphRepository {
  private static readonly UPSERT_ENTITY_SQL = `
    INSERT INTO kg_entities (type, external_id, label, meta)
    VALUES ($1, $2, $3, $4::jsonb)
    ON CONFLICT (type, external_id)
    DO UPDATE SET label = EXCLUDED.label, meta = EXCLUDED.meta
    RETURNING id, type, external_id AS "externalId", label, meta
  `;

  private static readonly UPSERT_RELATIONSHIP_SQL = `
    INSERT INTO kg_relationships (from_entity_id, to_entity_id, type)
    VALUES ($1, $2, $3)
    ON CONFLICT (from_entity_id, to_entity_id, type) DO NOTHING
    RETURNING id, from_entity_id AS "fromEntityId", to_entity_id AS "toEntityId", type
  `;

  private static readonly SEARCH_ENTITIES_SQL = `
    SELECT id, type, external_id AS "externalId", label, meta
    FROM kg_entities
    WHERE ($1::text IS NULL OR label ILIKE '%' || $1 || '%')
      AND ($2::text IS NULL OR type  = $2)
    LIMIT $3
  `;

  constructor(private readonly tenantDb: TenantQueryRunnerService) {}

  async upsertEntity(
    type: EntityType,
    externalId: string,
    label: string,
    meta: Record<string, unknown> = {},
  ): Promise<KGEntity> {
    return this.tenantDb.transaction(async (runner) => {
      // TypeORM's query returns a result object where the actual data is in .rows
      const result = await runner.query(KnowledgeGraphRepository.UPSERT_ENTITY_SQL, [
        type,
        externalId,
        label,
        JSON.stringify(meta),
      ]);
      return result[0];
    });
  }

  async upsertRelationship(
    fromEntityId: string,
    toEntityId: string,
    type: RelationshipType,
  ): Promise<KGRelationship | null> {
    return this.tenantDb.transaction(async (runner) => {
      const result = await runner.query(KnowledgeGraphRepository.UPSERT_RELATIONSHIP_SQL, [
        fromEntityId,
        toEntityId,
        type,
      ]);
      return result[0] ?? null;
    });
  }

  async search(keyword?: string, type?: EntityType, limit = 20): Promise<KGEntity[]> {
    return this.tenantDb.transaction(async (runner) => {
      const result = await runner.query(KnowledgeGraphRepository.SEARCH_ENTITIES_SQL, [
        keyword ?? null,
        type ?? null,
        limit,
      ]);
      // Explicit cast to ensure TypeScript sees this as the required array type
      return result as KGEntity[];
    });
  }
}
