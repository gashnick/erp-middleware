import { Module } from '@nestjs/common';
import { Request } from 'express';
// @ts-ignore
import { GraphQLModule as NestGraphQLModule } from '@nestjs/graphql';
// @ts-ignore
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';

@Module({
  imports: [
    NestGraphQLModule.forRoot<ApolloDriverConfig>({
      driver: ApolloDriver,
      autoSchemaFile: true,
      sortSchema: true,
      subscriptions: {
        'graphql-ws': {
          onConnect: (context: any) => {
            const req = context.extra?.request;
            return { req };
          },
        },
      },
      playground: true,
      // Just pass req — the middleware sets AsyncLocalStorage correctly via
      // tenantContext.run() which covers the entire request pipeline.
      // The resolver's runWithTenantContext handles the GraphQL async scope.
      // enterWith() was removed because it set a parent scope that leaked into
      // concurrent Promise.all chains inside ContextBuilderService.
      context: ({ req }: { req: Request }) => ({ req }),
    }),
  ],
})
export class GraphQLModule {}
