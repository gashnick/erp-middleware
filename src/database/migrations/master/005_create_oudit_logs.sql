CREATE TABLE public.audit_logs (
    id              BIGSERIAL PRIMARY KEY,
    tenant_id       UUID NOT NULL,
    user_id         UUID,
    action          VARCHAR(100) NOT NULL,  -- 'user.login', 'data.upload', 'export.csv'
    resource_type   VARCHAR(50),            -- 'invoice', 'payment', 'user'
    resource_id     UUID,
    ip_address      INET,
    user_agent      TEXT,
    metadata        JSONB,                  -- Additional context
    created_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_tenant_action ON public.audit_logs(tenant_id, action);
CREATE INDEX idx_audit_created ON public.audit_logs(created_at DESC);
CREATE INDEX idx_audit_user ON public.audit_logs(user_id) WHERE user_id IS NOT NULL;