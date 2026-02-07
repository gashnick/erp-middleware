CREATE TABLE public.subscriptions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    plan                VARCHAR(50) NOT NULL,
    status              VARCHAR(20) NOT NULL,  -- 'active' | 'trial' | 'expired' | 'cancelled'
    started_at          TIMESTAMP NOT NULL,
    expires_at          TIMESTAMP,             -- NULL for active subscriptions
    trial_ends_at       TIMESTAMP,             -- For trial period
    auto_renew          BOOLEAN DEFAULT true,
    payment_method      JSONB,                 -- Stripe/payment gateway reference
    created_at          TIMESTAMP NOT NULL DEFAULT NOW(),
    
    CONSTRAINT valid_plan CHECK (plan IN ('basic', 'standard', 'enterprise')),
    CONSTRAINT valid_status CHECK (status IN ('active', 'trial', 'expired', 'cancelled'))
);

CREATE INDEX idx_subscriptions_tenant ON public.subscriptions(tenant_id);
CREATE INDEX idx_subscriptions_status ON public.subscriptions(status);