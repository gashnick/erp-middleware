// src/chat/dynamic-query/dynamic-query.module.ts
//
// Declares all services in the dynamic query engine and exports
// DynamicDataFetcherService as the single public API for other modules.
//
// Import this module into ChatModule (or wherever ContextBuilderService lives).

import { Module } from '@nestjs/common';
import { QueryIntentService } from './query-intent.service';
import { DynamicQueryBuilderService } from './dynamic-query-builder.service';
import { ResultFormatterService } from './result-formatter.service';
import { DynamicDataFetcherService } from './dynamic-data-fetcher.service';
import { AnalyticsModule } from '@analytics/analytics.module';
import { DatabaseModule } from '@database/database.module';

@Module({
  imports: [
    DatabaseModule, // provides TenantQueryRunnerService
    AnalyticsModule, // provides AnalyticsCacheService (used by fallback)
  ],
  providers: [
    QueryIntentService,
    DynamicQueryBuilderService,
    ResultFormatterService,
    DynamicDataFetcherService,
  ],
  exports: [
    DynamicDataFetcherService, // only public API other modules need
  ],
})
export class DynamicQueryModule {}
