CREATE TABLE tenant_<uuid>.upload_batches (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    connector_id        UUID NOT NULL,              -- Reference to public.connectors
    file_name           VARCHAR(255) NOT NULL,
    file_size_bytes     BIGINT NOT NULL,
    template_type       VARCHAR(50) NOT NULL,       -- 'invoices' | 'payments' | 'expenses'
    total_rows          INTEGER NOT NULL,
    valid_rows          INTEGER NOT NULL,
    error_rows          INTEGER NOT NULL,
    warning_rows        INTEGER NOT NULL,
    status              VARCHAR(20) NOT NULL,       -- 'validating' | 'approved' | 'imported' | 'failed'
    validation_errors   JSONB,                      -- Detailed error report
    uploaded_by         UUID NOT NULL,              -- User ID
    approved_by         UUID,
    approved_at         TIMESTAMP,
    created_at          TIMESTAMP NOT NULL DEFAULT NOW(),
    
    CONSTRAINT valid_status CHECK (status IN ('validating', 'approved', 'imported', 'failed'))
);

CREATE INDEX idx_uploads_status ON tenant_<uuid>.upload_batches(status);
CREATE INDEX idx_uploads_created ON tenant_<uuid>.upload_batches(created_at DESC);
CREATE INDEX idx_uploads_user ON tenant_<uuid>.upload_batches(uploaded_by);