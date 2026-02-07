# File Tree: erp-middleware

**Generated:** 2/2/2026, 7:53:41 AM
**Root Path:** `c:\Users\gashn\Desktop\erp\erp-middleware`

```
├── 📁 src
│   ├── 📁 auth
│   │   ├── 📁 decorators
│   │   │   └── 📄 roles.decorator.ts
│   │   ├── 📁 dto
│   │   │   ├── 📄 login.dto.ts
│   │   │   ├── 📄 refresh-token.entity.ts
│   │   │   └── 📄 register.dto.ts
│   │   ├── 📁 entities
│   │   │   └── 📄 refresh-token.entity.ts
│   │   ├── 📁 enums
│   │   │   └── 📄 role.enum.ts
│   │   ├── 📁 guards
│   │   │   └── 📄 roles.guard.ts
│   │   ├── 📁 interfaces
│   │   │   └── 📄 authenticated-request.interface.ts
│   │   ├── 📁 strategies
│   │   │   ├── 📄 jwt.strategy.ts
│   │   │   └── 📄 local.strategy.ts
│   │   ├── 📁 types
│   │   │   └── 📄 login-response.type.ts
│   │   ├── 📄 auth.controller.ts
│   │   ├── 📄 auth.module.ts
│   │   ├── 📄 auth.service.spec.ts
│   │   └── 📄 auth.service.ts
│   ├── 📁 backup
│   │   ├── 📄 backup.scheduler.ts
│   │   └── 📄 backup.service.ts
│   ├── 📁 common
│   │   ├── 📁 audit
│   │   │   ├── 📄 audit.controller.ts
│   │   │   ├── 📄 audit.module.ts
│   │   │   └── 📄 audit.service.ts
│   │   ├── 📁 context
│   │   │   ├── 📄 tenant-context.spec.ts
│   │   │   └── 📄 tenant-context.ts
│   │   ├── 📁 database
│   │   │   └── 📄 query-helper.ts
│   │   ├── 📁 decorators
│   │   │   ├── 📄 active-tenant.decorator.ts
│   │   │   ├── 📄 check-limit.decorator.ts
│   │   │   ├── 📄 current-tenant.decorator.ts
│   │   │   └── 📄 current-user.decorator.ts
│   │   ├── 📁 exceptions
│   │   │   ├── 📄 missing-tenant-context.exception.ts
│   │   │   └── 📄 tenant-not-found.exception.ts
│   │   ├── 📁 filters
│   │   │   ├── 📄 all-exceptions.filter.ts
│   │   │   └── 📄 http-exception.filter.ts
│   │   ├── 📁 guards
│   │   │   ├── 📄 jwt-auth.guard.ts
│   │   │   ├── 📄 subscription-limit.guard.ts
│   │   │   ├── 📄 tenant-context.guard.ts
│   │   │   └── 📄 tenant.guard.ts
│   │   ├── 📁 interceptors
│   │   │   ├── 📄 audit-logging.interceptor.ts
│   │   │   └── 📄 tenant-schema.interceptor.ts
│   │   ├── 📁 interfaces
│   │   │   └── 📄 error-response.interface.ts
│   │   ├── 📁 metrics
│   │   │   ├── 📄 metrics.controller.ts
│   │   │   ├── 📄 metrics.module.ts
│   │   │   └── 📄 metrics.service.ts
│   │   ├── 📁 middleware
│   │   │   ├── 📄 tenant-context.middleware.spec.ts
│   │   │   └── 📄 tenant-context.middleware.ts
│   │   └── 📁 security
│   │       ├── 📄 encryption.module.ts
│   │       └── 📄 encryption.service.ts
│   ├── 📁 config
│   │   ├── 📄 config.module.ts
│   │   ├── 📄 config.service.spec.ts
│   │   ├── 📄 config.service.ts
│   │   └── 📄 configuration.ts
│   ├── 📁 connectors
│   │   ├── 📁 implementations
│   │   │   └── 📄 csv.connector.ts
│   │   ├── 📁 interfaces
│   │   │   └── 📄 connector.interface.ts
│   │   ├── 📁 providers
│   │   │   ├── 📄 postgres-provider.ts
│   │   │   └── 📄 quickbooks-provider.ts
│   │   ├── 📄 base.connector.ts
│   │   ├── 📄 connector-health.service.ts
│   │   ├── 📄 connectors.controller.ts
│   │   └── 📄 connectors.module.ts
│   ├── 📁 database
│   │   ├── 📁 migrations
│   │   │   ├── 📁 master
│   │   │   │   ├── 📄 001_create_tenant.sql
│   │   │   │   ├── 📄 002_create_users.sql
│   │   │   │   ├── 📄 003_create_subscriptions.sql
│   │   │   │   ├── 📄 004_create_connectors.sql
│   │   │   │   ├── 📄 005_create_oudit_logs.sql
│   │   │   │   ├── 📄 006_create_roles.sql
│   │   │   │   ├── 📄 1705000000001-CreateTenants.ts
│   │   │   │   ├── 📄 1705000000002-CreateUsers.ts
│   │   │   │   ├── 📄 1705000000003-create-refresh-tokens.ts
│   │   │   │   ├── 📄 1705000000004-CreateSubscriptionPlansTable.ts
│   │   │   │   ├── 📄 1705000000005-CreateSubscriptions.ts
│   │   │   │   ├── 📄 1705000000006-CreateConnectors.ts
│   │   │   │   ├── 📄 1705000000007-CreateAuditLogs.ts
│   │   │   │   └── 📄 1705000000008-CreateRefreshTokensTable.ts
│   │   │   └── 📁 tenant
│   │   │       ├── 📄 001_finance_core.sql
│   │   │       ├── 📄 002_payments.sql
│   │   │       ├── 📄 003_expenses.sql
│   │   │       ├── 📄 004_ai_insights.sql
│   │   │       ├── 📄 005_upload_batches.sql
│   │   │       └── 📄 1705000000004-InitialTenantSchema.ts
│   │   ├── 📁 seeds
│   │   │   ├── 📄 master.seed.ts
│   │   │   └── 📄 tenant.seed.ts
│   │   ├── 📄 database.module.ts
│   │   ├── 📄 database.service.spec.ts
│   │   ├── 📄 database.service.ts
│   │   ├── 📄 tenant-connection.service.ts
│   │   ├── 📄 tenant-migration-runner.service.ts
│   │   ├── 📄 tenant-query-runner.service.spec.ts
│   │   ├── 📄 tenant-query-runner.service.ts
│   │   └── 📄 tenant-schema-template.ts
│   ├── 📁 etl
│   │   ├── 📁 dto
│   │   │   ├── 📄 quarantine-retry.dto.ts
│   │   │   ├── 📄 query-quarantine.dto.ts
│   │   │   └── 📄 sync-status.dto.ts
│   │   ├── 📁 interfaces
│   │   │   ├── 📄 etl.interfaces.ts
│   │   │   ├── 📄 invoice-data.interface.ts
│   │   │   └── 📄 tenant-entities.interface.ts
│   │   ├── 📁 services
│   │   │   ├── 📄 etl-transformer.service.ts
│   │   │   ├── 📄 etl.service.ts
│   │   │   └── 📄 quarantine.service.ts
│   │   ├── 📄 etl.module.ts
│   │   └── 📄 quarantine.controller.ts
│   ├── 📁 finance
│   │   ├── 📁 dto
│   │   │   └── 📄 dashboard-summary.dto.ts
│   │   ├── 📁 invoices
│   │   │   ├── 📁 dto
│   │   │   │   ├── 📄 create-invoice.dto.ts
│   │   │   │   └── 📄 update-invoice.dto.ts
│   │   │   ├── 📄 invoices.controller.ts
│   │   │   ├── 📄 invoices.module.ts
│   │   │   ├── 📄 invoices.service.spec.ts
│   │   │   └── 📄 invoices.service.ts
│   │   ├── 📄 finance-analytics.service.ts
│   │   ├── 📄 finance.controller.ts
│   │   ├── 📄 finance.module.ts
│   │   └── 📄 finance.service.ts
│   ├── 📁 health
│   │   └── 📄 health.controller.ts
│   ├── 📁 subscription
│   │   └── 📁 entities
│   │       └── 📄 subscription.entity.ts
│   ├── 📁 subscription-plans
│   │   └── 📁 entities
│   │       └── 📄 subscription-plan.entity.ts
│   ├── 📁 tenants
│   │   ├── 📁 dto
│   │   │   └── 📄 create-tenant.dto.ts
│   │   ├── 📁 entities
│   │   │   └── 📄 tenant.entity.ts
│   │   ├── 📄 tenant-provisioning.service.ts
│   │   ├── 📄 tenants.controller.ts
│   │   ├── 📄 tenants.module.ts
│   │   └── 📄 tenants.service.spec.ts
│   ├── 📁 users
│   │   ├── 📁 dto
│   │   │   └── 📄 create-user.dto.ts
│   │   ├── 📁 entities
│   │   │   └── 📄 user.entity.ts
│   │   ├── 📁 tests
│   │   │   └── 📄 users.service.spec.ts
│   │   ├── 📄 users.controller.ts
│   │   ├── 📄 users.module.ts
│   │   └── 📄 users.service.ts
│   ├── 📄 app.controller.spec.ts
│   ├── 📄 app.controller.ts
│   ├── 📄 app.module.ts
│   ├── 📄 app.service.ts
│   └── 📄 main.ts
├── 📁 test
│   ├── 📄 app.e2e-spec.ts
│   ├── 📄 auth-boundary.e2e-spec.ts
│   ├── 📄 auth.e2e-spec.ts
│   ├── 📄 concurrency-safety.e2e-spec.ts
│   ├── 📄 connectors-resilience.e2e-spec.ts
│   ├── 📄 failure-isolation.e2e-spec.ts
│   ├── 📄 isolation-enforcement.e2e-spec.ts
│   ├── ⚙️ jest-e2e.json
│   ├── 📄 month-1-mvp-complete.e2e-spec.ts
│   ├── 📄 onboarding-diagnostic.e2e-spec.ts
│   ├── 📄 onboarding-flow.e2e-spec.ts
│   ├── 📄 rbac-enforcement.e2e-spec.ts
│   ├── 📄 rbac-gates.e2e-spec.ts
│   ├── 📄 request-scope.e2e-spec.ts
│   ├── 📄 security-encryption.e2e-spec.ts
│   ├── 📄 tenant-context.e2e-spec.ts
│   ├── 📄 tenant-isolation.e2e-spec.ts
│   └── 📄 test-app.bootstrap.ts
├── 📄 .eslintrc.js
├── ⚙️ .gitignore
├── ⚙️ .prettierrc
├── 📝 MULTI_TENANT_ARCHITECTURE.md
├── 📝 README.md
├── ⚙️ docker-compose.yml
├── 📄 eslint.config.mjs
├── ⚙️ nest-cli.json
├── 📄 ormconfig.ts
├── ⚙️ package-lock.json
├── ⚙️ package.json
└── ⚙️ tsconfig.json
```

---

_Generated by FileTree Pro Extension_
