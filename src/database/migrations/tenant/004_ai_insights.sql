CREATE TABLE tenant_<uuid>.ai_insights (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    insight_type    VARCHAR(50) NOT NULL,           -- 'summary' | 'anomaly' | 'forecast' | 'recommendation'
    scope           VARCHAR(50) NOT NULL,           -- 'finance' | 'hr' | 'operations'
    title           VARCHAR(255) NOT NULL,
    summary         TEXT NOT NULL,
    details         JSONB NOT NULL,                 -- Structured insight data
    confidence      DECIMAL(3, 2),                  -- 0.00 to 1.00
    priority        VARCHAR(20),                    -- 'low' | 'medium' | 'high' | 'critical'
    status          VARCHAR(20) NOT NULL,           -- 'new' | 'viewed' | 'acknowledged' | 'dismissed'
    valid_until     TIMESTAMP,                      -- For time-sensitive insights
    metadata        JSONB,
    created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
    
    CONSTRAINT valid_insight_type CHECK (insight_type IN ('summary', 'anomaly', 'forecast', 'recommendation')),
    CONSTRAINT valid_priority CHECK (priority IN ('low', 'medium', 'high', 'critical')),
    CONSTRAINT valid_status CHECK (status IN ('new', 'viewed', 'acknowledged', 'dismissed'))
);

CREATE INDEX idx_insights_type ON tenant_<uuid>.ai_insights(insight_type);
CREATE INDEX idx_insights_status ON tenant_<uuid>.ai_insights(status) WHERE status = 'new';
CREATE INDEX idx_insights_priority ON tenant_<uuid>.ai_insights(priority, created_at DESC);
CREATE INDEX idx_insights_created ON tenant_<uuid>.ai_insights(created_at DESC);