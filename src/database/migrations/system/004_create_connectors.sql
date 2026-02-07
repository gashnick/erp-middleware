CREATE TABLE public.connectors (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    name            VARCHAR(255) NOT NULL,          -- User-friendly name
    type            VARCHAR(50) NOT NULL,           -- 'csv_upload' (MVP)
    config          JSONB NOT NULL,                 -- Type-specific settings
    status          VARCHAR(20) NOT NULL,           -- 'active' | 'paused' | 'error'
    last_sync_at    TIMESTAMP,
    next_sync_at    TIMESTAMP,
    sync_frequency  VARCHAR(50),                    -- 'manual' | 'hourly' | 'daily'
    error_message   TEXT,
    created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMP NOT NULL DEFAULT NOW(),
    
    CONSTRAINT valid_type CHECK (type IN ('csv_upload', 'postgres', 'quickbooks')),
    CONSTRAINT valid_status CHECK (status IN ('active', 'paused', 'error'))
);

CREATE INDEX idx_connectors_tenant ON public.connectors(tenant_id);
CREATE INDEX idx_connectors_status ON public.connectors(tenant_id, status);

-- Example config for CSV upload:
-- {
--   "allowed_templates": ["invoices", "payments", "expenses"],
--   "auto_process": false,
--   "validation_strict": true
-- }