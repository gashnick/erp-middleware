CREATE TABLE public.tenants (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    schema_name         VARCHAR(63) UNIQUE NOT NULL,  -- tenant_<uuid>
    company_name        VARCHAR(255) NOT NULL,
    data_source_type    VARCHAR(20) NOT NULL,         -- 'internal' | 'external'
    subscription_plan   VARCHAR(50) NOT NULL,         -- 'basic' | 'standard' | 'enterprise'
    plan_limits         JSONB NOT NULL,               -- storage, users, connectors, etc.
    status              VARCHAR(20) NOT NULL,         -- 'active' | 'suspended' | 'cancelled'
    created_at          TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMP NOT NULL DEFAULT NOW(),
    deleted_at          TIMESTAMP,                    -- Soft delete
    
    CONSTRAINT valid_data_source CHECK (data_source_type IN ('internal', 'external')),
    CONSTRAINT valid_plan CHECK (subscription_plan IN ('basic', 'standard', 'enterprise')),
    CONSTRAINT valid_status CHECK (status IN ('active', 'suspended', 'cancelled'))
);

CREATE INDEX idx_tenants_status ON public.tenants(status) WHERE deleted_at IS NULL;
CREATE INDEX idx_tenants_schema ON public.tenants(schema_name);

-- Example plan_limits JSON:
-- {
--   "max_users": 5,
--   "max_storage_mb": 1000,
--   "max_connectors": 1,
--   "max_api_calls_per_month": 10000,
--   "features": ["finance_dashboard", "csv_upload", "basic_ai"]
-- }