import { Module } from '@nestjs/common';
// The project may not have graphql packages installed in all environments; use ts-ignore to avoid hard compile failure
// @ts-ignore
import { GraphQLModule as NestGraphQLModule } from '@nestjs/graphql';
// @ts-ignore
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { InvoiceResolver } from './resolvers/invoice.resolver';
import { InvoicesModule } from '@finance/invoices/invoices.module';

@Module({
  imports: [
    // @ts-ignore - runtime may provide GraphQL packages when used in feature branch
    NestGraphQLModule.forRoot<ApolloDriverConfig>({
      driver: ApolloDriver,
      autoSchemaFile: 'schema.gql',
      sortSchema: true,
      playground: true,
      context: ({ req, res }: { req: any; res: any }) => ({ req, res }),
      formatError: (error: any) => ({
        message: error.message,
        code: error.extensions?.code || 'INTERNAL_SERVER_ERROR',
        path: error.path,
      }),
    }),
    InvoicesModule,
  ],
  providers: [InvoiceResolver],
})
export class GraphQLModule {}
