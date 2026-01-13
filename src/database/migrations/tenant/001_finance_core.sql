CREATE TABLE tenant_<uuid>.invoices (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_number  VARCHAR(100) NOT NULL,          -- Business key
    customer_name   VARCHAR(255) NOT NULL,
    customer_email  VARCHAR(255),
    amount          DECIMAL(15, 2) NOT NULL,
    currency        VARCHAR(3) NOT NULL DEFAULT 'USD',
    tax_amount      DECIMAL(15, 2) DEFAULT 0,
    total_amount    DECIMAL(15, 2) GENERATED ALWAYS AS (amount + tax_amount) STORED,
    issue_date      DATE NOT NULL,
    due_date        DATE NOT NULL,
    status          VARCHAR(20) NOT NULL,           -- 'draft' | 'sent' | 'paid' | 'overdue' | 'cancelled'
    notes           TEXT,
    metadata        JSONB,                          -- Custom fields
    created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMP NOT NULL DEFAULT NOW(),
    
    CONSTRAINT valid_status CHECK (status IN ('draft', 'sent', 'paid', 'overdue', 'cancelled')),
    CONSTRAINT valid_amount CHECK (amount >= 0),
    CONSTRAINT valid_currency CHECK (currency ~ '^[A-Z]{3}$'),
    CONSTRAINT unique_invoice_number UNIQUE (invoice_number)
);

CREATE INDEX idx_invoices_status ON tenant_<uuid>.invoices(status);
CREATE INDEX idx_invoices_due_date ON tenant_<uuid>.invoices(due_date) WHERE status != 'paid';
CREATE INDEX idx_invoices_customer ON tenant_<uuid>.invoices(customer_name);
CREATE INDEX idx_invoices_created ON tenant_<uuid>.invoices(created_at DESC);