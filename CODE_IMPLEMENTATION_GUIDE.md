# 🔨 Code-Level Implementation Guide

## Table of Contents
1. [GraphQL Implementation](#graphql-implementation)
2. [Tenant-Aware Rate Limiting](#tenant-aware-rate-limiting)
3. [Route Refactoring](#route-refactoring)
4. [New Modules](#new-modules)
5. [Middleware Updates](#middleware-updates)

---

## 1. GraphQL Implementation

### Install Dependencies
```bash
npm install @nestjs/graphql @nestjs/apollo @apollo/server graphql
```

### Create GraphQL Module

**File**: `src/graphql/graphql.module.ts`
```typescript
import { Module } from '@nestjs/common';
import { GraphQLModule as NestGraphQLModule } from '@nestjs/graphql';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { InvoiceResolver } from './resolvers/invoice.resolver';
import { OrderResolver } from './resolvers/order.resolver';
import { ProductResolver } from './resolvers/product.resolver';
import { AssetResolver } from './resolvers/asset.resolver';
import { InvoicesModule } from '@finance/invoices/invoices.module';
import { OrdersModule } from '@orders/orders.module';

@Module({
  imports: [
    NestGraphQLModule.forRoot<ApolloDriverConfig>({
      driver: ApolloDriver,
      autoSchemaFile: 'schema.gql',
      sortSchema: true,
      playground: true,
      context: ({ req }) => ({ req }),
      formatError: (error) => ({
        message: error.message,
        code: error.extensions?.code,
        path: error.path,
      }),
    }),
    InvoicesModule,
    OrdersModule,
  ],
  providers: [InvoiceResolver, OrderResolver, ProductResolver, AssetResolver],
})
export class GraphQLModule {}
```

### Invoice Resolver

**File**: `src/graphql/resolvers/invoice.resolver.ts`
```typescript
import { Resolver, Query, Mutation, Args, Context } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { TenantGuard } from '@common/guards/tenant.guard';
import { InvoicesService } from '@finance/invoices/invoices.service';
import { Invoice } from '../types/invoice.type';
import { CreateInvoiceInput } from '../types/create-invoice.input';
import { UpdateInvoiceInput } from '../types/update-invoice.input';

@Resolver(() => Invoice)
@UseGuards(JwtAuthGuard, TenantGuard)
export class InvoiceResolver {
  constructor(private readonly invoicesService: InvoicesService) {}

  @Query(() => [Invoice], { name: 'invoices' })
  async getInvoices(
    @Args('limit', { type: () => Int, nullable: true }) limit: number = 10,
    @Args('offset', { type: () => Int, nullable: true }) offset: number = 0,
    @Context() context: any,
  ) {
    const tenantId = context.req.user.tenantId;
    return this.invoicesService.findAll(tenantId, { limit, offset });
  }

  @Query(() => Invoice, { name: 'invoice', nullable: true })
  async getInvoice(
    @Args('id', { type: () => ID }) id: string,
    @Context() context: any,
  ) {
    const tenantId = context.req.user.tenantId;
    return this.invoicesService.findOne(id, tenantId);
  }

  @Mutation(() => Invoice)
  async createInvoice(
    @Args('input') input: CreateInvoiceInput,
    @Context() context: any,
  ) {
    const tenantId = context.req.user.tenantId;
    return this.invoicesService.create(tenantId, input);
  }

  @Mutation(() => Invoice)
  async updateInvoice(
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: UpdateInvoiceInput,
    @Context() context: any,
  ) {
    const tenantId = context.req.user.tenantId;
    return this.invoicesService.update(id, tenantId, input);
  }
}
```

### GraphQL Types

**File**: `src/graphql/types/invoice.type.ts`
```typescript
import { ObjectType, Field, ID, Float, registerEnumType } from '@nestjs/graphql';

export enum InvoiceStatus {
  DRAFT = 'draft',
  PENDING = 'pending',
  PAID = 'paid',
  OVERDUE = 'overdue',
  CANCELLED = 'cancelled',
}

registerEnumType(InvoiceStatus, { name: 'InvoiceStatus' });

@ObjectType()
export class Invoice {
  @Field(() => ID)
  id: string;

  @Field()
  customerName: string;

  @Field(() => Float)
  amount: number;

  @Field()
  currency: string;

  @Field(() => InvoiceStatus)
  status: InvoiceStatus;

  @Field({ nullable: true })
  externalId?: string;

  @Field()
  createdAt: Date;

  @Field()
  updatedAt: Date;
}
```

**File**: `src/graphql/types/create-invoice.input.ts`
```typescript
import { InputType, Field, Float } from '@nestjs/graphql';
import { IsString, IsNumber, IsEnum, IsOptional } from 'class-validator';
import { InvoiceStatus } from './invoice.type';

@InputType()
export class CreateInvoiceInput {
  @Field()
  @IsString()
  customerName: string;

  @Field(() => Float)
  @IsNumber()
  amount: number;

  @Field({ defaultValue: 'USD' })
  @IsString()
  currency: string;

  @Field(() => InvoiceStatus, { defaultValue: InvoiceStatus.DRAFT })
  @IsEnum(InvoiceStatus)
  status: InvoiceStatus;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  externalId?: string;
}
```

---

## 2. Tenant-Aware Rate Limiting

### Rate Limit Guard

**File**: `src/common/guards/tenant-rate-limit.guard.ts`
```typescript
import { Injectable, CanActivate, ExecutionContext, HttpException, HttpStatus } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Tenant } from '@tenants/entities/tenant.entity';
import Redis from 'ioredis';

interface RateLimitConfig {
  basic: number;
  standard: number;
  enterprise: number;
}

@Injectable()
export class TenantRateLimitGuard implements CanActivate {
  private redis: Redis;
  private readonly limits: RateLimitConfig = {
    basic: 60,      // 60 requests/minute
    standard: 120,  // 120 requests/minute
    enterprise: 300 // 300 requests/minute
  };

  constructor(
    @InjectRepository(Tenant)
    private tenantRepo: Repository<Tenant>,
    private reflector: Reflector,
  ) {
    this.redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
    });
  }

  async canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user?.tenantId) {
      // Public endpoints or non-tenant requests
      return true;
    }

    const tenant = await this.tenantRepo.findOne({
      where: { id: user.tenantId },
      select: ['id', 'subscription_plan'],
    });

    if (!tenant) {
      throw new HttpException('Tenant not found', HttpStatus.UNAUTHORIZED);
    }

    const limit = this.limits[tenant.subscription_plan] || this.limits.basic;
    const key = `rate_limit:${tenant.id}:${Math.floor(Date.now() / 60000)}`;

    const current = await this.redis.incr(key);
    
    if (current === 1) {
      await this.redis.expire(key, 60); // Expire after 1 minute
    }

    if (current > limit) {
      throw new HttpException(
        {
          statusCode: 429,
          message: 'Rate limit exceeded',
          limit,
          current,
          retryAfter: 60,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // Add rate limit headers
    const response = context.switchToHttp().getResponse();
    response.setHeader('X-RateLimit-Limit', limit);
    response.setHeader('X-RateLimit-Remaining', Math.max(0, limit - current));
    response.setHeader('X-RateLimit-Reset', Math.floor(Date.now() / 1000) + 60);

    return true;
  }
}
```

### Apply to Controllers

**Update**: `src/finance/invoices/invoices.controller.ts`
```typescript
import { TenantRateLimitGuard } from '@common/guards/tenant-rate-limit.guard';

@Controller('invoices')
@UseGuards(JwtAuthGuard, TenantGuard, TenantRateLimitGuard) // Add rate limiting
export class InvoicesController {
  // ... existing code
}
```

---

## 3. Route Refactoring

### 3.1 Rename Tenants Controller

**File**: `src/tenants/tenants.controller.ts`
```typescript
import { Controller, Post, Get, Body, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { TenantProvisioningService } from './tenant-provisioning.service';
import { AuthService } from '../auth/auth.service';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { CreateTenantDto } from './dto/create-tenant.dto';

@ApiTags('Tenants')
@Controller('tenants') // CHANGED: from 'provisioning'
export class TenantsController {
  constructor(
    private readonly provisioningService: TenantProvisioningService,
    private readonly authService: AuthService,
  ) {}

  @Post() // CHANGED: from 'organizations'
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  async create(@Request() req, @Body() dto: CreateTenantDto) {
    const userId = req.user.id;
    const result = await this.provisioningService.createOrganization(userId, dto);
    const session = await this.authService.generateTenantSession(userId, result.tenantId);

    return {
      id: result.tenantId,
      name: dto.companyName,
      slug: result.slug,
      accessToken: session.access_token,
      refreshToken: session.refresh_token,
    };
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  async findOne(@Param('id') id: string) {
    return this.provisioningService.findById(id);
  }
}
```

### 3.2 Consolidate SSO Callback

**File**: `src/auth/auth.controller.ts`
```typescript
@Controller('auth')
export class AuthController {
  // ... existing endpoints

  @Post('sso/callback') // NEW: Unified SSO callback
  async ssoCallback(@Body() body: SsoCallbackDto) {
    const { provider, code, state } = body;
    
    let user;
    switch (provider) {
      case 'google':
        user = await this.authService.handleGoogleCallback(code);
        break;
      case 'github':
        user = await this.authService.handleGithubCallback(code);
        break;
      case 'microsoft':
        user = await this.authService.handleMicrosoftCallback(code);
        break;
      default:
        throw new BadRequestException('Unsupported SSO provider');
    }

    return this.authService.oauthLogin(user);
  }

  // DEPRECATED: Keep for backward compatibility during migration
  @Get('google/callback')
  @UseGuards(GoogleOAuthGuard)
  async googleAuthCallback(@Req() req, @Res() res) {
    // Redirect to new endpoint
    return res.redirect(307, '/api/auth/sso/callback');
  }
}
```

### 3.3 Create Insights Controller (Consolidate AI/Finance)

**File**: `src/insights/insights.controller.ts`
```typescript
import { Controller, Get, Post, Body, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { TenantGuard } from '@common/guards/tenant.guard';
import { TenantRateLimitGuard } from '@common/guards/tenant-rate-limit.guard';
import { FinanceService } from '@finance/finance.service';
import { AnalyticsService } from '@ai/services/analytics.service';
import { AnomalyDetectionService } from '@ai/services/anomaly-detection.service';
import { CurrentUser } from '@common/decorators/current-user.decorator';

@ApiTags('Insights')
@Controller('insights')
@UseGuards(JwtAuthGuard, TenantGuard, TenantRateLimitGuard)
@ApiBearerAuth()
export class InsightsController {
  constructor(
    private readonly financeService: FinanceService,
    private readonly analyticsService: AnalyticsService,
    private readonly anomalyService: AnomalyDetectionService,
  ) {}

  @Get()
  async getInsights(
    @CurrentUser() user,
    @Query('type') type?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const tenantId = user.tenantId;

    // Consolidate: finance dashboard + AI insights + anomalies
    const [dashboard, analytics, anomalies] = await Promise.all([
      this.financeService.getDashboardStats(tenantId),
      this.analyticsService.generateInsights(tenantId),
      this.anomalyService.detectAnomalies(tenantId),
    ]);

    return {
      financial: dashboard,
      analytics,
      anomalies,
      generatedAt: new Date().toISOString(),
    };
  }

  @Post('query')
  async queryInsights(
    @CurrentUser() user,
    @Body() body: { query: string; format?: string },
  ) {
    const tenantId = user.tenantId;
    
    // Natural language query processing (was /ai/chat)
    return this.analyticsService.processNaturalLanguageQuery(
      tenantId,
      body.query,
      body.format,
    );
  }
}
```

---

## 4. New Modules

### 4.1 Orders Module

**File**: `src/orders/orders.module.ts`
```typescript
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { Order } from './entities/order.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Order])],
  controllers: [OrdersController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
```

**File**: `src/orders/entities/order.entity.ts`
```typescript
import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';

export enum OrderStatus {
  IN_PROGRESS = 'in_progress',
  READY = 'ready',
  COMPLETED = 'completed',
}

@Entity('orders')
export class Order {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  tenant_id: string;

  @Column()
  customer_name: string;

  @Column('decimal', { precision: 10, scale: 2 })
  total_amount: number;

  @Column({
    type: 'enum',
    enum: OrderStatus,
    default: OrderStatus.IN_PROGRESS,
  })
  status: OrderStatus;

  @Column('jsonb', { nullable: true })
  items: any[];

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
```

**File**: `src/orders/orders.controller.ts`
```typescript
import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { TenantGuard } from '@common/guards/tenant.guard';
import { TenantRateLimitGuard } from '@common/guards/tenant-rate-limit.guard';
import { OrdersService } from './orders.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { CurrentUser } from '@common/decorators/current-user.decorator';

@ApiTags('Orders')
@Controller('orders')
@UseGuards(JwtAuthGuard, TenantGuard, TenantRateLimitGuard)
@ApiBearerAuth()
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post()
  async create(@CurrentUser() user, @Body() dto: CreateOrderDto) {
    return this.ordersService.create(user.tenantId, dto);
  }

  @Get()
  async findAll(
    @CurrentUser() user,
    @Query('status') status?: string,
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
  ) {
    return this.ordersService.findAll(user.tenantId, { status, limit, offset });
  }

  @Patch(':id/status')
  async updateStatus(
    @CurrentUser() user,
    @Param('id') id: string,
    @Body() dto: UpdateOrderStatusDto,
  ) {
    return this.ordersService.updateStatus(user.tenantId, id, dto.status);
  }
}
```

**File**: `src/orders/dto/update-order-status.dto.ts`
```typescript
import { IsEnum } from 'class-validator';
import { OrderStatus } from '../entities/order.entity';

export class UpdateOrderStatusDto {
  @IsEnum(OrderStatus, {
    message: 'Status must be one of: in_progress, ready, completed',
  })
  status: OrderStatus;
}
```

### 4.2 Webhooks Module

**File**: `src/webhooks/webhooks.module.ts`
```typescript
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';
import { Webhook } from './entities/webhook.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Webhook])],
  controllers: [WebhooksController],
  providers: [WebhooksService],
  exports: [WebhooksService],
})
export class WebhooksModule {}
```

**File**: `src/webhooks/entities/webhook.entity.ts`
```typescript
import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn } from 'typeorm';

export enum WebhookEvent {
  DATA_SYNCED = 'data_synced',
  ORDER_STATUS_CHANGED = 'order_status_changed',
  ALERT_RAISED = 'alert_raised',
}

@Entity('webhooks')
export class Webhook {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  tenant_id: string;

  @Column()
  url: string;

  @Column('simple-array')
  events: WebhookEvent[];

  @Column({ default: true })
  is_active: boolean;

  @Column({ nullable: true })
  secret: string;

  @CreateDateColumn()
  created_at: Date;
}
```

**File**: `src/webhooks/webhooks.controller.ts`
```typescript
import { Controller, Get, Post, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { TenantGuard } from '@common/guards/tenant.guard';
import { WebhooksService } from './webhooks.service';
import { RegisterWebhookDto } from './dto/register-webhook.dto';
import { CurrentUser } from '@common/decorators/current-user.decorator';

@ApiTags('Webhooks')
@Controller('webhooks')
@UseGuards(JwtAuthGuard, TenantGuard)
@ApiBearerAuth()
export class WebhooksController {
  constructor(private readonly webhooksService: WebhooksService) {}

  @Post('register')
  async register(@CurrentUser() user, @Body() dto: RegisterWebhookDto) {
    return this.webhooksService.register(user.tenantId, dto);
  }

  @Get()
  async list(@CurrentUser() user) {
    return this.webhooksService.findAll(user.tenantId);
  }

  @Delete(':id')
  async remove(@CurrentUser() user, @Param('id') id: string) {
    return this.webhooksService.remove(user.tenantId, id);
  }
}
```

**File**: `src/webhooks/dto/register-webhook.dto.ts`
```typescript
import { IsUrl, IsArray, IsEnum } from 'class-validator';
import { WebhookEvent } from '../entities/webhook.entity';

export class RegisterWebhookDto {
  @IsUrl()
  url: string;

  @IsArray()
  @IsEnum(WebhookEvent, { each: true })
  events: WebhookEvent[];
}
```

### 4.3 Usage Tracking Module

**File**: `src/usage/usage.controller.ts`
```typescript
import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { TenantGuard } from '@common/guards/tenant.guard';
import { UsageService } from './usage.service';
import { CurrentUser } from '@common/decorators/current-user.decorator';

@ApiTags('Usage')
@Controller('usage')
@UseGuards(JwtAuthGuard, TenantGuard)
@ApiBearerAuth()
export class UsageController {
  constructor(private readonly usageService: UsageService) {}

  @Get()
  async getUsage(@CurrentUser() user) {
    return this.usageService.getUsageStats(user.tenantId);
  }
}
```

---

## 5. Middleware Updates

### Update App Module

**File**: `src/app.module.ts`
```typescript
import { Module } from '@nestjs/common';
import { GraphQLModule } from './graphql/graphql.module';
import { OrdersModule } from './orders/orders.module';
import { InsightsModule } from './insights/insights.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { UsageModule } from './usage/usage.module';
// ... existing imports

@Module({
  imports: [
    // ... existing modules
    GraphQLModule,      // NEW
    OrdersModule,       // NEW
    InsightsModule,     // NEW
    WebhooksModule,     // NEW
    UsageModule,        // NEW
  ],
  // ... rest of config
})
export class AppModule {}
```

### Update Main.ts

**File**: `src/main.ts`
```typescript
async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  
  // ... existing config
  
  // Add GraphQL playground note
  logger.log(`🎮 GraphQL Playground: http://localhost:${port}/graphql`);
  
  await app.listen(port);
}
```

---

## 6. Database Migrations

### Create Orders Table

**File**: `src/database/migrations/tenant/1234567890125-CreateOrdersTable.ts`
```typescript
import { MigrationInterface, QueryRunner, Table } from 'typeorm';

export class CreateOrdersTable1234567890125 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'orders',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            default: 'uuid_generate_v4()',
          },
          {
            name: 'tenant_id',
            type: 'uuid',
            isNullable: false,
          },
          {
            name: 'customer_name',
            type: 'varchar',
            length: '255',
          },
          {
            name: 'total_amount',
            type: 'decimal',
            precision: 10,
            scale: 2,
          },
          {
            name: 'status',
            type: 'enum',
            enum: ['in_progress', 'ready', 'completed'],
            default: "'in_progress'",
          },
          {
            name: 'items',
            type: 'jsonb',
            isNullable: true,
          },
          {
            name: 'created_at',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
          },
          {
            name: 'updated_at',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
          },
        ],
        indices: [
          {
            name: 'IDX_orders_tenant_id',
            columnNames: ['tenant_id'],
          },
          {
            name: 'IDX_orders_status',
            columnNames: ['status'],
          },
        ],
      }),
      true,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('orders');
  }
}
```

### Create Webhooks Table

**File**: `src/database/migrations/tenant/1234567890126-CreateWebhooksTable.ts`
```typescript
import { MigrationInterface, QueryRunner, Table } from 'typeorm';

export class CreateWebhooksTable1234567890126 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'webhooks',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            default: 'uuid_generate_v4()',
          },
          {
            name: 'tenant_id',
            type: 'uuid',
            isNullable: false,
          },
          {
            name: 'url',
            type: 'varchar',
            length: '500',
          },
          {
            name: 'events',
            type: 'text',
          },
          {
            name: 'is_active',
            type: 'boolean',
            default: true,
          },
          {
            name: 'secret',
            type: 'varchar',
            length: '255',
            isNullable: true,
          },
          {
            name: 'created_at',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
          },
        ],
        indices: [
          {
            name: 'IDX_webhooks_tenant_id',
            columnNames: ['tenant_id'],
          },
        ],
      }),
      true,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('webhooks');
  }
}
```

---

## Summary of Changes

### Files to Create (18 new files)
1. `src/graphql/graphql.module.ts`
2. `src/graphql/resolvers/invoice.resolver.ts`
3. `src/graphql/resolvers/order.resolver.ts`
4. `src/graphql/types/invoice.type.ts`
5. `src/graphql/types/create-invoice.input.ts`
6. `src/common/guards/tenant-rate-limit.guard.ts`
7. `src/orders/orders.module.ts`
8. `src/orders/orders.controller.ts`
9. `src/orders/orders.service.ts`
10. `src/orders/entities/order.entity.ts`
11. `src/orders/dto/create-order.dto.ts`
12. `src/orders/dto/update-order-status.dto.ts`
13. `src/insights/insights.module.ts`
14. `src/insights/insights.controller.ts`
15. `src/webhooks/webhooks.module.ts`
16. `src/webhooks/webhooks.controller.ts`
17. `src/webhooks/entities/webhook.entity.ts`
18. `src/usage/usage.controller.ts`

### Files to Modify (5 files)
1. `src/tenants/tenants.controller.ts` - Rename routes
2. `src/auth/auth.controller.ts` - Add SSO callback
3. `src/app.module.ts` - Import new modules
4. `src/main.ts` - Add GraphQL logging
5. `src/finance/invoices/invoices.controller.ts` - Add rate limiting

### Files to Deprecate (Keep but mark)
1. `src/etl/etl.controller.ts` - Mark as internal/admin-only
2. `src/etl/quarantine.controller.ts` - Mark as internal/admin-only
3. `src/finance/finance.controller.ts` - Redirect to /insights

---

**Next Steps**: Review this implementation guide and begin Phase 1 development.
