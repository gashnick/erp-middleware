import { Injectable, Logger } from '@nestjs/common';
import { KnowledgeGraphRepository } from './knowledge-graph.repository';
import { KGEntity } from './knowledge-graph.types';
import { getTenantContext } from '@common/context/tenant-context';

const STOP_WORDS = new Set([
  'the',
  'a',
  'an',
  'for',
  'of',
  'in',
  'is',
  'what',
  'why',
  'show',
  'me',
  'our',
  'how',
]);

@Injectable()
export class GraphQueryService {
  private readonly logger = new Logger(GraphQueryService.name);

  constructor(private readonly repo: KnowledgeGraphRepository) {}

  async findRelevantEntities(question: string): Promise<KGEntity[]> {
    // 1. Context validation
    // We don't pass tenantId to the repo anymore, but we check here to ensure
    // the search_path logic in the repository has a context to work with.
    const ctx = getTenantContext();
    if (!ctx?.tenantId) {
      this.logger.error('Attempted Graph Search without tenant context');
      return [];
    }

    // 2. Extract keywords for basic search matching
    const keywords = question
      .toLowerCase()
      .split(/\W+/)
      .filter((w) => w.length > 3 && !STOP_WORDS.has(w));

    if (!keywords.length) return [];

    // 3. Search using the refactored Repository
    // The signature is now: search(keyword?: string, type?: EntityType, limit?: number)
    // No tenantId is passed; the Repository resolves it via AsyncLocalStorage.
    return this.repo.search(keywords[0], undefined, 10);
  }
}
