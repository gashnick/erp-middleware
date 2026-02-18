# 🔧 API Refactoring Plan: Strict Contract Compliance

## 📊 Executive Summary

**Objective**: Refactor existing API to strictly match the documented contract while preserving business logic and ensuring production stability.

**Status**: ⚠️ CRITICAL - Multiple breaking changes required

**Timeline**: 3-5 days for full implementation + testing

---

## 🚨 Critical Findings

### Architectural Violations

1. **ETL/Quarantine Exposure**: Internal data pipeline endpoints are publicly exposed
2. **Inconsistent Naming**: Mix of `/provisioning`, `/tenants`, `/finance`, `/ai` for similar concerns
3. **Missing GraphQL**: Data access layer not implemented
4. **No Tenant-Aware Rate Limiting**: Rate limits not enforced per subscription tier
5. **OAuth Fragmentation**: Provider-specific callbacks instead of unified SSO

### Security Concerns

- ETL ingestion endpoint allows direct data manipulation
- Quarantine management exposed without proper RBAC
- No webhook signature verification
- Missing usage tracking for billing

---

## 📋 Complete Route Mapping

### ✅ Auth Endpoints (Mostly Compliant)

| Current | Target | Status | Action |
|---------|--------|--------|--------|
| `POST /auth/register` | N/A (not in contract) | ⚠️ Extra | Keep for onboarding |
| `POST /auth/login` | `POST /auth/login` | ✅ Match | No change |
| `POST /auth/refresh` | `POST /auth/refresh` | ✅ Match | No change |
| `GET /auth/google/callback` | `POST /auth/sso/callback` | ❌ Mismatch | Consolidate |
| `GET /auth/github/callback` | `POST /auth/sso/callback` | ❌ Mismatch | Consolidate |
| `POST /auth/promote` | N/A | ⚠️ Extra | Keep (internal) |

**Changes Required**:
```typescript
// NEW: Unified SSO callback
@Post('sso/callback')
async ssoCallback(@Body() body: { provider: string; code: string; state?: string }) {
  // Handle Google, GitHub, Microsoft, etc.
}
```

---

### ❌ Tenants & Users (Major Refactor)

| Current | Target | Status | Action |
|---------|--------|--------|--------|
| `POST /provisioning/organizations` | `POST /tenants` | ❌ Wrong path | Rename controller |
| `GET /tenants/organizations` | `GET /tenants/{id}` | ❌ Wrong structure | Restructure |
| `POST /users` | `POST /users` | ✅ Match | No change |
| `PATCH /users/{id}` | `PATCH /users/{id}` | ✅ Match | No change |
| `GET /users/me` | N/A | ⚠️ Extra | Keep (useful) |

**Changes Required**:
```typescript
// RENAME: TenantsController
@Controller('tenants')
export class TenantsController {
  @Post() // Was: POST /provisioning/organizations
  async create(@Body() dto: CreateTenantDto) { }
  
  @Get(':id') // Was: GET /tenants/organizations
  async findOne(@Param('id') id: string) { }
}
```

---

### ❌ Connectors (Partially Compliant)

| Current | Target | Status | Action |
|---------|--------|--------|--------|
| `POST /connectors` | `POST /connectors` | ✅ Match | No change |
| `POST /connectors/{id}/sync` | `POST /connectors/{id}/sync` | ✅ Match | No change |
| `GET /connectors/{id}/health` | `GET /connectors/{id}/health` | ✅ Match | No change |
| `POST /connectors/csv-upload` | N/A | ⚠️ Extra | Move to internal |
| `GET /connectors/status` | N/A | ⚠️ Extra | Remove |
| `GET /connectors/types` | N/A | ⚠️ Extra | Remove |

**Changes Required**:
- Remove extra endpoints
- Keep only contract-specified routes

---

### ❌ Data Access (Missing GraphQL)

| Current | Target | Status | Action |
|---------|--------|--------|--------|
| `GET /invoices` | `/graphql` | ❌ REST not allowed | Migrate to GraphQL |
| `POST /invoices` | `/graphql` | ❌ REST not allowed | Migrate to GraphQL |
| `PATCH /invoices/{id}` | `/graphql` | ❌ REST not allowed | Migrate to GraphQL |
| N/A | `/graphql` | ❌ Missing | **CREATE** |

**Changes Required**:
```bash
npm install @nestjs/graphql @nestjs/apollo @apollo/server graphql
```

```typescript
// NEW: GraphQL Module
@Module({
  imports: [
    GraphQLModule.forRoot<ApolloDriverConfig>({
      driver: ApolloDriver,
      autoSchemaFile: true,
      context: ({ req }) => ({ req }),
    }),
  ],
})
```

```graphql
# Schema
type Invoice {
  id: ID!
  customerName: String!
  amount: Float!
  status: InvoiceStatus!
}

type Query {
  invoices(limit: Int, offset: Int): [Invoice!]!
  invoice(id: ID!): Invoice
  orders: [Order!]!
  products: [Product!]!
  assets: [Asset!]!
}

type Mutation {
  createInvoice(input: CreateInvoiceInput!): Invoice!
  updateInvoice(id: ID!, input: UpdateInvoiceInput!): Invoice!
}
```

---

### ❌ Insights (Consolidate AI/Finance)

| Current | Target | Status | Action |
|---------|--------|--------|--------|
| `GET /finance/dashboard` | `GET /insights` | ❌ Wrong path | Consolidate |
| `GET /ai/analytics/*` | `GET /insights` | ❌ Wrong path | Consolidate |
| `GET /ai/anomalies` | `GET /insights` | ❌ Wrong path | Consolidate |
| `POST /ai/chat` | `POST /insights/query` | ❌ Wrong path | Consolidate |
| N/A | `GET /insights` | ❌ Missing | **CREATE** |
| N/A | `POST /insights/query` | ❌ Missing | **CREATE** |

**Changes Required**:
```typescript
// NEW: Unified Insights Controller
@Controller('insights')
export class InsightsController {
  @Get()
  async getInsights(@Query() filters: InsightFiltersDto) {
    // Consolidate: finance dashboard + AI insights + anomalies
  }
  
  @Post('query')
  async queryInsights(@Body() query: InsightQueryDto) {
    // Natural language queries (was /ai/chat)
  }
}
```

---

### ❌ Orders (Missing Entirely)

| Current | Target | Status | Action |
|---------|--------|--------|--------|
| N/A | `POST /orders` | ❌ Missing | **CREATE** |
| N/A | `GET /orders` | ❌ Missing | **CREATE** |
| N/A | `PATCH /orders/{id}/status` | ❌ Missing | **CREATE** |

**Changes Required**:
```typescript
// NEW: Orders Module
@Controller('orders')
export class OrdersController {
  @Post()
  async create(@Body() dto: CreateOrderDto) { }
  
  @Get()
  async findAll(@Query() filters: OrderFiltersDto) { }
  
  @Patch(':id/status')
  async updateStatus(
    @Param('id') id: string,
    @Body() dto: { status: 'in_progress' | 'ready' | 'completed' }
  ) { }
}
```

---

### ❌ Subscriptions (Rename + Extend)

| Current | Target | Status | Action |
|---------|--------|--------|--------|
| `GET /subscription-plans` | `GET /subscription` | ❌ Wrong path | Rename |
| N/A | `POST /subscription/upgrade` | ❌ Missing | **CREATE** |
| N/A | `GET /usage` | ❌ Missing | **CREATE** |

**Changes Required**:
```typescript
// RENAME: subscription-plans → subscription
@Controller('subscription')
export class SubscriptionController {
  @Get()
  async getCurrent(@CurrentUser() user) {
    // Return user's current subscription
  }
  
  @Post('upgrade')
  async upgrade(@Body() dto: { plan: string }) { }
}

@Controller('usage')
export class UsageController {
  @Get()
  async getUsage(@CurrentUser() user) {
    // Return API usage, storage, etc.
  }
}
```

---

### ❌ Webhooks (Missing Entirely)

| Current | Target | Status | Action |
|---------|--------|--------|--------|
| N/A | `POST /webhooks/register` | ❌ Missing | **CREATE** |

**Changes Required**:
```typescript
// NEW: Webhooks Module
@Controller('webhooks')
export class WebhooksController {
  @Post('register')
  async register(@Body() dto: RegisterWebhookDto) {
    // Events: data_synced, order_status_changed, alert_raised
  }
  
  @Get()
  async list() { }
  
  @Delete(':id')
  async remove(@Param('id') id: string) { }
}
```

---

### 🗑️ Internal Endpoints (Remove from Public API)

| Current | Reason | Action |
|---------|--------|--------|
| `POST /etl/ingest` | Internal pipeline | Move to admin-only or remove |
| `GET /etl/jobs/{id}` | Internal monitoring | Move to admin-only |
| `GET /quarantine` | Internal data quality | Move to admin-only |
| `POST /quarantine/{id}/retry` | Internal operations | Move to admin-only |
| `POST /connectors/csv-upload` | Internal upload | Keep but document as internal |

---

## 🔒 Rate Limiting Implementation

### Current State
- Generic rate limiting via `ProductionRateLimitGuard`
- Not tenant-aware
- No subscription tier differentiation

### Target State
```typescript
@Injectable()
export class TenantRateLimitGuard implements CanActivate {
  async canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const tenant = await this.getTenant(request.user.tenantId);
    
    const limits = {
      basic: 60,      // 60 req/min
      standard: 120,  // 120 req/min
      enterprise: 300 // 300 req/min (configurable)
    };
    
    const limit = limits[tenant.subscriptionPlan] || 60;
    return this.checkRateLimit(tenant.id, limit);
  }
}
```

**Apply to all tenant-scoped routes**:
```typescript
@UseGuards(JwtAuthGuard, TenantRateLimitGuard)
@Controller('invoices')
```

---

## 📦 New Modules Required

### 1. GraphQL Module
```bash
src/graphql/
├── resolvers/
│   ├── invoice.resolver.ts
│   ├── order.resolver.ts
│   ├── product.resolver.ts
│   └── asset.resolver.ts
├── types/
│   └── graphql.schema.ts
└── graphql.module.ts
```

### 2. Orders Module
```bash
src/orders/
├── dto/
│   ├── create-order.dto.ts
│   └── update-order-status.dto.ts
├── entities/
│   └── order.entity.ts
├── orders.controller.ts
├── orders.service.ts
└── orders.module.ts
```

### 3. Insights Module (Consolidation)
```bash
src/insights/
├── insights.controller.ts
├── insights.service.ts
├── insights.module.ts
└── dto/
    ├── insight-query.dto.ts
    └── insight-filters.dto.ts
```

### 4. Webhooks Module
```bash
src/webhooks/
├── webhooks.controller.ts
├── webhooks.service.ts
├── webhooks.module.ts
└── entities/
    └── webhook.entity.ts
```

### 5. Usage Tracking Module
```bash
src/usage/
├── usage.controller.ts
├── usage.service.ts
├── usage.module.ts
└── interceptors/
    └── usage-tracking.interceptor.ts
```

---

## 🔄 Migration Strategy

### Phase 1: Add New Endpoints (Week 1)
- ✅ Create GraphQL module
- ✅ Create Orders module
- ✅ Create Insights module (consolidate AI/Finance)
- ✅ Create Webhooks module
- ✅ Create Usage module
- ✅ Implement tenant-aware rate limiting

### Phase 2: Deprecation Warnings (Week 2)
- ⚠️ Add deprecation headers to old endpoints
- ⚠️ Log usage of deprecated routes
- ⚠️ Update documentation with migration guide

### Phase 3: Dual Support (Week 3-4)
- 🔄 Both old and new routes active
- 🔄 Monitor traffic patterns
- 🔄 Notify clients of upcoming changes

### Phase 4: Remove Old Routes (Week 5)
- 🗑️ Remove deprecated endpoints
- 🗑️ Update tests
- 🗑️ Final documentation update

---

## 🧪 Testing Requirements

### Unit Tests
- [ ] All new controllers
- [ ] GraphQL resolvers
- [ ] Rate limiting guard
- [ ] Webhook signature verification

### Integration Tests
- [ ] GraphQL queries/mutations
- [ ] Order workflow (create → in_progress → ready → completed)
- [ ] Webhook delivery
- [ ] Rate limit enforcement per tier
- [ ] Tenant isolation in new endpoints

### E2E Tests
- [ ] Complete user journey with new API
- [ ] Migration path from old to new API
- [ ] Backward compatibility during transition

---

## 📝 Documentation Updates

### README.md
- Update all curl examples
- Update API endpoint list
- Add GraphQL playground instructions
- Add webhook setup guide

### Postman Collection
- Rename folders to match new structure
- Add GraphQL requests
- Add Orders requests
- Add Webhooks requests
- Update all URLs

### Swagger/OpenAPI
- Update all route decorators
- Add deprecation notices
- Document rate limits per tier
- Add webhook event schemas

---

## ⚠️ Breaking Changes Summary

### High Impact (Requires Client Updates)
1. **Tenant Creation**: `POST /provisioning/organizations` → `POST /tenants`
2. **Data Access**: REST endpoints → GraphQL
3. **Insights**: Multiple endpoints → Unified `/insights`
4. **SSO**: Provider-specific → Generic `/auth/sso/callback`

### Medium Impact (Deprecation Period)
1. **Subscription Plans**: `/subscription-plans` → `/subscription`
2. **Finance Dashboard**: `/finance/dashboard` → `/insights`
3. **AI Endpoints**: `/ai/*` → `/insights` or `/insights/query`

### Low Impact (Internal Only)
1. **ETL**: Move to admin-only
2. **Quarantine**: Move to admin-only
3. **Connector extras**: Remove non-standard endpoints

---

## 🎯 Success Criteria

- [ ] All target contract endpoints implemented
- [ ] No extra public endpoints (except documented exceptions)
- [ ] Tenant-aware rate limiting active
- [ ] GraphQL playground accessible
- [ ] All tests passing
- [ ] Documentation updated
- [ ] Postman collection updated
- [ ] Zero downtime migration plan documented

---

## 📞 Stakeholder Communication

### Development Team
- Review this plan
- Estimate effort for each phase
- Identify risks and dependencies

### Product Team
- Approve breaking changes
- Define migration timeline
- Communicate to customers

### DevOps Team
- Plan deployment strategy
- Set up monitoring for new endpoints
- Configure rate limiting infrastructure

---

## 🚀 Next Steps

1. **Approve this plan** with stakeholders
2. **Create JIRA tickets** for each module
3. **Set up feature branches** for parallel development
4. **Begin Phase 1** implementation
5. **Schedule weekly sync** to track progress

---

**Document Version**: 1.0  
**Last Updated**: 2024-02-16  
**Owner**: Backend Architecture Team
