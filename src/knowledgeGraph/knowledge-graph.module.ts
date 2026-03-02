import { Module } from '@nestjs/common';
import { DatabaseModule } from '@database/database.module';
import { KnowledgeGraphRepository } from './knowledge-graph.repository';
import { GraphBuilderService } from './graph-builder.service';
import { GraphQueryService } from './graph-query.service';
import { KnowledgeGraphResolver } from './knowledge-graph.resolver';

@Module({
  imports: [DatabaseModule],
  providers: [
    KnowledgeGraphRepository,
    GraphBuilderService,
    GraphQueryService,
    KnowledgeGraphResolver,
  ],
  exports: [GraphQueryService, GraphBuilderService],
})
export class KnowledgeGraphModule {}
