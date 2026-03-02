# Schema-Per-Tenant Architecture

## Overview

This ERP middleware uses a **schema-per-tenant** isolation model for maximum security and data separation.

## Schema Structure

### Public Schema (Global/Shared Tables)

Located in: `src/database/migrations/system/`

**Tables:**
1. **tenants** - Tenant registry with schema names
2. **users** - User accounts (can belong to multiple tenants)
3. **subscription_plans** - Available subscription tiers
4. **subscriptions** - Tenant subscription records
5. **connectors** - External system integrations
6. **refresh_tokens** - JWT refresh tokens
7. **tenant_encryption_keys** - Per-tenant encryption keys (KMS-wrapped)
8. **audit_logs** - System-wide audit trail (immutable)
9. **prompt_templates** - Global AI prompt templates (versioned)

**Characteristics:**
- No tenant_id filtering needed
- Shared across all tenants
- Managed by system administrators

---

### Tenant Schemas (Isolated Per Tenant)

Located in: `src/database/migrations/tenant/`

Each tenant gets a dedicated schema (e.g., `tenant_acme_corp_abc123`) with these tables:

**Core Finance Tables:**
1. **contacts** - Customer/vendor contacts
2. **invoices** - Invoice records
3. **products** - Product catalog
4. **orders** - Order records

**ETL & Data Quality:**
5. **quarantine_records** - Failed/invalid data records

**AI & Intelligence (Month 2):**
6. **ai_insights** - AI-generated insights
7. **chat_sessions** - User chat sessions
8. **chat_messages** - Chat conversation history
9. **anomalies** - Detected financial anomalies
10. **kg_entities** - Knowledge graph entities
11. **kg_relationships** - Knowledge graph relationships
12. **insight_feedback** - User feedback on insights

**Characteristics:**
- NO `tenant_id` column (isolation via schema)
- NO foreign keys to public.tenants
- Complete data isolation
- Automatic cleanup on tenant deletion

---

## Benefits of Schema-Per-Tenant

✅ **Strong Isolation**: Physical separation prevents cross-tenant data leaks  
✅ **Performance**: No tenant_id filtering overhead  
✅ **Compliance**: Easier GDPR/data residency compliance  
✅ **Backup/Restore**: Per-tenant backup and recovery  
✅ **Scalability**: Can move schemas to different databases  
✅ **Security**: Schema-level permissions and RLS policies  

---

## Migration Strategy

### System Migrations
Run once on application startup:
```bash
npm run migration:run
```

### Tenant Migrations
Run automatically when provisioning new tenant:
```typescript
await tenantProvisioningService.createTenant({
  companyName: 'Acme Corp',
  dataSourceType: 'external',
  subscriptionPlan: 'enterprise'
});
```

---

## Query Patterns

### Public Schema Query
```typescript
// Direct query - no tenant context needed
const plans = await dataSource.query('SELECT * FROM public.subscription_plans');
```

### Tenant Schema Query
```typescript
// Set schema context first
await queryRunner.query(`SET search_path TO ${schemaName}`);
const invoices = await queryRunner.query('SELECT * FROM invoices');
```

### Using TenantQueryRunner Service
```typescript
// Automatic schema switching
const invoices = await tenantQueryRunner.query(
  tenantId,
  'SELECT * FROM invoices WHERE status = $1',
  ['paid']
);
```

---

## Security Considerations

1. **Schema Naming**: Uses cryptographic hash to prevent enumeration
   - Format: `tenant_{slug}_{hash}`
   - Example: `tenant_acme_corp_a1b2c3d4`

2. **Access Control**: 
   - JWT tokens include `tenantId`
   - Middleware validates tenant access
   - Schema switching enforced at query level

3. **Encryption**:
   - Sensitive fields encrypted with tenant-specific keys
   - Keys stored in `public.tenant_encryption_keys`
   - Master key managed via KMS

4. **Audit Trail**:
   - All tenant operations logged to `public.audit_logs`
   - Immutable (trigger prevents updates/deletes)
   - Includes correlation IDs for tracing

---

## Adding New Tenant Tables

1. Create migration in `src/database/migrations/tenant/`
2. **DO NOT** include `tenant_id` column
3. **DO NOT** add FK to `public.tenants`
4. Run migration via tenant provisioning service

Example:
```typescript
export class AddPaymentsTable1705000000002 {
  public async up(queryRunner: any): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "payments" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "invoice_id" uuid NOT NULL,
        "amount" decimal(15,2) NOT NULL,
        "payment_date" timestamp NOT NULL,
        CONSTRAINT "FK_payments_invoice" 
          FOREIGN KEY ("invoice_id") 
          REFERENCES "invoices"("id") 
          ON DELETE CASCADE
      );
    `);
  }
}
```

---

## Troubleshooting

### Schema Not Found
```
ERROR: schema "tenant_xyz" does not exist
```
**Solution**: Verify tenant exists and schema was created during provisioning

### Cross-Schema Reference
```
ERROR: cross-database references are not implemented
```
**Solution**: Don't create FKs from tenant schema to public schema

### Permission Denied
```
ERROR: permission denied for schema tenant_xyz
```
**Solution**: Ensure database user has CREATE/USAGE on all schemas

---

## Future Enhancements

- [ ] Schema-level RLS policies
- [ ] Automated schema archival for inactive tenants
- [ ] Multi-region schema distribution
- [ ] Schema-level connection pooling
- [ ] Tenant data export/import utilities
