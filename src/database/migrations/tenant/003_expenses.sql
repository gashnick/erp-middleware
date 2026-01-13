CREATE TABLE tenant_<uuid>.expenses (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    expense_number  VARCHAR(100) NOT NULL,
    category        VARCHAR(100) NOT NULL,          -- 'office_supplies', 'software', 'utilities'
    vendor_name     VARCHAR(255),
    amount          DECIMAL(15, 2) NOT NULL,
    currency        VARCHAR(3) NOT NULL DEFAULT 'USD',
    expense_date    DATE NOT NULL,
    status          VARCHAR(20) NOT NULL,           -- 'pending' | 'approved' | 'rejected' | 'paid'
    description     TEXT,
    receipt_url     TEXT,
    metadata        JSONB,
    created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMP NOT NULL DEFAULT NOW(),
    
    CONSTRAINT valid_status CHECK (status IN ('pending', 'approved', 'rejected', 'paid')),
    CONSTRAINT valid_amount CHECK (amount >= 0),
    CONSTRAINT unique_expense_number UNIQUE (expense_number)
);

CREATE INDEX idx_expenses_category ON tenant_<uuid>.expenses(category);
CREATE INDEX idx_expenses_status ON tenant_<uuid>.expenses(status);
CREATE INDEX idx_expenses_date ON tenant_<uuid>.expenses(expense_date DESC);
CREATE INDEX idx_expenses_vendor ON tenant_<uuid>.expenses(vendor_name);