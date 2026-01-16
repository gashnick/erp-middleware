# Multi-Tenant Architecture Implementation

## Overview

This document describes a **fully leak-proof multi-tenant architecture** implemented following Code Complete principles: modularity, encapsulation, fail-fast, and single responsibility. The architecture ensures complete tenant isolation at all levels - application, database, and security.

## Architecture Principles

### 1. **Tenant Isolation Enforced Before Authentication**

- Tenant context is set **before** user authentication
- Supports both header-based (`X-Tenant-ID`) and JWT-based tenant identification
- No tenant data access without explicit tenant context

### 2. **Single Data Access Point**

- **ALL** tenant data access goes through `TenantQueryRunnerService`
- Direct `DataSource` queries to tenant schemas are **FORBIDDEN**
- Centralized query execution with automatic context propagation

### 3. **Thread-Safe Context Propagation**

- Uses `AsyncLocalStorage` for automatic context inheritance
- All async calls automatically inherit the correct tenant context
- No manual context passing required

### 4. **Atomic Tenant Creation**

- **Transaction spans**: tenant record creation → schema generation → migrations → commit
- Complete rollback on any failure
- No partial tenant states possible

### 5. **Database-Level Isolation**

- Dedicated PostgreSQL roles: `tenant_public_role` and `tenant_schema_role`
- Schema names: `tenant_<32_hex_chars>` (e.g., `tenant_a1b2c3d4...`)
- Automatic role switching per tenant context
- `search_path` validation prevents SQL injection

## Core Components

### TenantContextMiddleware

**Location**: `src/common/middleware/tenant-context.middleware.ts`

**Responsibilities**:

1. Extract tenant ID from `X-Tenant-ID` header or JWT
2. Validate tenant exists (except during creation)
3. Set AsyncLocalStorage context
4. Log context switches for audit
5. Execute request with tenant context

**Key Features**:

- Priority: Header → JWT → Fail-fast
- Supports tenant creation (skips validation)
- Comprehensive logging with correlation IDs

### TenantContextGuard

**Location**: `src/common/guards/tenant-context.guard.ts`

**Responsibilities**:

- Ensure tenant context exists before request processing
- Fail-fast if context missing
- Log security violations

### TenantQueryRunnerService

**Location**: `src/database/tenant-query-runner.service.ts`

**Responsibilities**:

- Provide tenant-scoped database connections
- Automatic role switching and schema isolation
- Transaction management
- Query execution with audit logging

**Key Methods**:

- `getRunner()`: Get QueryRunner with tenant isolation
- `execute()`: Simple queries with auto-cleanup
- `transaction()`: Atomic operations

### Tenant Context Utilities

**Location**: `src/common/context/tenant-context.ts`

**Utility Methods**:

- `getTenantContext()`: Get current context (fail-fast)
- `getTenantId()`, `getSchemaName()`, `getUserId()`: Context accessors
- `setTenantContextForJob()`: Explicit context for background jobs

## Database Schema

### Master Schema (public)

- `tenants` table: Tenant metadata
- `users` table: User accounts (if needed)
- Other shared tables

### Tenant Schemas (tenant\_\*)

- `invoices`: Invoice data
- `payments`: Payment records
- `expenses`: Expense tracking
- `ai_insights`: AI-generated insights
- `upload_batches`: Data import batches

### Roles and Permissions

```sql
-- Public data access role
CREATE ROLE tenant_public_role;
GRANT CONNECT ON DATABASE erp_middleware TO tenant_public_role;
GRANT USAGE ON SCHEMA public TO tenant_public_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO tenant_public_role;

-- Tenant schema access role
CREATE ROLE tenant_schema_role;
GRANT CONNECT ON DATABASE erp_middleware TO tenant_schema_role;

-- Each tenant schema gets:
GRANT USAGE ON SCHEMA tenant_xyz TO tenant_schema_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA tenant_xyz TO tenant_schema_role;
```

## Request Flow

### Normal Request (Authenticated User)

1. **TenantContextMiddleware** extracts tenant from JWT
2. Validates tenant exists and is active
3. Sets AsyncLocalStorage context
4. Logs context switch
5. **TenantContextGuard** verifies context exists
6. **Controller/Service** uses TenantQueryRunnerService
7. Automatic schema/role switching in database

### Tenant Creation Request

1. **TenantContextMiddleware** extracts tenant from `X-Tenant-ID` header
2. Skips validation (tenant doesn't exist yet)
3. Sets context for creation
4. **TenantsService.create()** runs atomic transaction:
   - Create tenant record
   - Generate schema with tables
   - Grant permissions
   - Commit or rollback completely

### Background Job

```typescript
const cleanup = setTenantContextForJob(tenantId, 'system', uuidv4());
try {
  // Tenant-scoped operations
  await this.tenantQueryRunner.execute('SELECT * FROM invoices');
} finally {
  cleanup(); // Critical: Always restore context
}
```

## Security Features

### 1. **Fail-Fast Design**

- No tenant context = Request rejected
- Invalid schema names = Query rejected
- Missing permissions = Access denied

### 2. **SQL Injection Prevention**

- Schema names validated: `/^tenant_[a-f0-9]{32}$/`
- Parameterized queries only
- No dynamic SQL construction

### 3. **Audit Logging**

Every operation logged with:

- Request ID for correlation
- Tenant ID
- User ID
- Action performed
- Timestamp

### 4. **Database Role Isolation**

- Connections automatically switch roles
- Public tables use `tenant_public_role`
- Tenant schemas use `tenant_schema_role`
- No cross-tenant data access possible

## Usage Examples

### Controller with Tenant Safety

```typescript
@Controller('invoices')
@UseGuards(TenantContextGuard)
export class InvoicesController {
  constructor(private readonly tenantQueryRunner: TenantQueryRunnerService) {}

  @Get()
  async findAll() {
    // Automatically scoped to current tenant
    return this.tenantQueryRunner.execute('SELECT * FROM invoices');
  }

  @Post()
  async create(@Body() dto: CreateInvoiceDto) {
    return this.tenantQueryRunner.transaction(async (runner) => {
      const result = await runner.query(
        'INSERT INTO invoices (customer_name, amount) VALUES ($1, $2) RETURNING *',
        [dto.customerName, dto.amount],
      );
      return result[0];
    });
  }
}
```

### Tenant Creation

```typescript
// POST /tenants with X-Tenant-ID header
{
  "companyName": "Acme Corp",
  "dataSourceType": "external",
  "subscriptionPlan": "basic"
}

// Atomic process:
// 1. Create tenant record in transaction
// 2. Generate schema tenant_<uuid>
// 3. Create all tables with permissions
// 4. Commit or rollback completely
```

## Configuration

### Environment Variables

```env
# Database
DB_HOST=localhost
DB_PORT=5432
DB_NAME=erp_middleware
DB_USER=erp_user
DB_PASSWORD=secure_password

# JWT (if used)
JWT_SECRET=your-secret-key
```

### Module Setup

```typescript
@Module({
  imports: [
    DatabaseModule,
    // ... other modules
  ],
  providers: [TenantQueryRunnerService, TenantConnectionService, TenantsService],
})
export class AppModule {}
```

## Monitoring and Maintenance

### Health Checks

- Schema integrity verification
- Connection pool monitoring
- Role permission validation

### Cleanup Procedures

- Orphaned schema detection
- Connection pool management
- Context leak prevention

### Audit Review

- Context switch logs
- Query execution logs
- Failed access attempts

## Code Complete Principles Applied

### 1. **Modularity**

- Each component has single responsibility
- Clear interfaces between modules
- Easy to test and maintain

### 2. **Encapsulation**

- Tenant context hidden from business logic
- Database details abstracted
- Security logic centralized

### 3. **Fail-Fast**

- Invalid states detected immediately
- No silent failures or data leaks
- Clear error messages for debugging

### 4. **Single Responsibility**

- Middleware: Context management only
- Guard: Access control only
- Service: Business logic only
- QueryRunner: Database access only

## Migration Path

For existing single-tenant applications:

1. **Add tenant context infrastructure**
2. **Create roles and permissions**
3. **Update all queries to use TenantQueryRunnerService**
4. **Add guards to controllers**
5. **Implement tenant creation logic**
6. **Test isolation thoroughly**

## Testing Strategy

### Unit Tests

- Context propagation
- Schema validation
- Role switching

### Integration Tests

- Full request flows
- Database isolation
- Transaction atomicity

### E2E Tests

- Multi-tenant data isolation
- Performance under load
- Failure scenarios

## Performance Considerations

- Connection pooling per tenant
- Query result caching
- Schema-specific optimizations
- Audit log rotation

## Troubleshooting

### Common Issues

1. **"Tenant context not set"**
   - Check middleware order in app module
   - Verify X-Tenant-ID header or JWT

2. **"Schema does not exist"**
   - Run tenant creation process
   - Check database migrations

3. **Permission denied**
   - Verify role assignments
   - Check connection role switching

### Debug Commands

```sql
-- Check current search_path and role
SELECT current_user, current_schema();

-- List tenant schemas
SELECT schema_name FROM information_schema.schemata
WHERE schema_name LIKE 'tenant_%';

-- Check role permissions
SELECT * FROM information_schema.role_table_grants
WHERE grantee = 'tenant_schema_role';
```

---

**This architecture provides bulletproof tenant isolation while maintaining development simplicity and performance.**
