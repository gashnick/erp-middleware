CREATE TABLE public.users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    email           VARCHAR(255) NOT NULL,
    password_hash   VARCHAR(255) NOT NULL,  -- bcrypt hash
    full_name       VARCHAR(255) NOT NULL,
    role            VARCHAR(50) NOT NULL,   -- 'admin' | 'manager' | 'analyst' | 'staff'
    status          VARCHAR(20) NOT NULL,   -- 'active' | 'inactive' | 'invited'
    last_login_at   TIMESTAMP,
    created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMP NOT NULL DEFAULT NOW(),
    deleted_at      TIMESTAMP,
    
    CONSTRAINT valid_role CHECK (role IN ('admin', 'manager', 'analyst', 'staff')),
    CONSTRAINT valid_status CHECK (status IN ('active', 'inactive', 'invited')),
    CONSTRAINT unique_email_per_tenant UNIQUE (tenant_id, email)
);

CREATE INDEX idx_users_tenant ON public.users(tenant_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_users_email ON public.users(email) WHERE deleted_at IS NULL;
CREATE INDEX idx_users_status ON public.users(tenant_id, status);