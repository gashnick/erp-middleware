CREATE TABLE tenant_<uuid>.payments (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_number  VARCHAR(100) NOT NULL,
    invoice_id      UUID REFERENCES tenant_<uuid>.invoices(id) ON DELETE SET NULL,
    amount          DECIMAL(15, 2) NOT NULL,
    currency        VARCHAR(3) NOT NULL DEFAULT 'USD',
    method          VARCHAR(50) NOT NULL,           -- 'cash' | 'bank_transfer' | 'credit_card' | 'mobile_money'
    transaction_id  VARCHAR(255),                   -- External txn reference
    payment_date    DATE NOT NULL,
    status          VARCHAR(20) NOT NULL,           -- 'pending' | 'completed' | 'failed' | 'refunded'
    notes           TEXT,
    metadata        JSONB,
    created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMP NOT NULL DEFAULT NOW(),
    
    CONSTRAINT valid_status CHECK (status IN ('pending', 'completed', 'failed', 'refunded')),
    CONSTRAINT valid_amount CHECK (amount >= 0),
    CONSTRAINT unique_payment_number UNIQUE (payment_number)
);

CREATE INDEX idx_payments_invoice ON tenant_<uuid>.payments(invoice_id);
CREATE INDEX idx_payments_status ON tenant_<uuid>.payments(status);
CREATE INDEX idx_payments_date ON tenant_<uuid>.payments(payment_date DESC);
CREATE INDEX idx_payments_method ON tenant_<uuid>.payments(method);