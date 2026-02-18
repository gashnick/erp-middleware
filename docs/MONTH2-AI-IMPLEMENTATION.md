# Month 2: AI Intelligence Layer - Implementation Guide

## 🎯 Overview

This document describes the AI Intelligence Layer implementation for the ERP Middleware, providing conversational AI, anomaly detection, analytics, and knowledge graph capabilities.

---

## 📐 Architecture

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     AI Intelligence Layer                    │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │   Chat API   │  │  Analytics   │  │  Anomalies   │      │
│  │   /ai/chat   │  │  /ai/analytics│  │ /ai/anomalies│      │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘      │
│         │                  │                  │               │
│         └──────────────────┴──────────────────┘              │
│                            │                                  │
│         ┌──────────────────▼──────────────────┐             │
│         │      Context Builder Service         │             │
│         │  - Tenant-scoped data extraction     │             │
│         │  - PII redaction                     │             │
│         │  - Time range parsing                │             │
│         └──────────────────┬──────────────────┘             │
│                            │                                  │
│         ┌──────────────────▼──────────────────┐             │
│         │         LLM Service                  │             │
│         │  - OpenAI / Gemini integration       │             │
│         │  - Prompt orchestration              │             │
│         │  - Response validation               │             │
│         └──────────────────────────────────────┘             │
│                                                               │
├─────────────────────────────────────────────────────────────┤
│                    Supporting Services                        │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌──────────────────┐  ┌──────────────────┐                │
│  │ Anomaly Detection│  │ Knowledge Graph  │                │
│  │  - Expense spikes│  │  - Entity mapping│                │
│  │  - Duplicates    │  │  - Relationships │                │
│  │  - Unusual pays  │  │  - Graph queries │                │
│  └──────────────────┘  └──────────────────┘                │
│                                                               │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                   Tenant Database Layer                       │
│  - Multi-tenant isolation                                     │
│  - Encrypted data storage                                     │
│  - Query optimization                                         │
└─────────────────────────────────────────────────────────────┘
```

---

## 🏗️ Component Architecture

### 1. **LLM Service** (`llm.service.ts`)

**Purpose**: Interface with AI providers (OpenAI/Gemini)

**Key Features**:
- Multi-provider support (OpenAI GPT-4, Google Gemini)
- Dynamic system prompt generation
- Response validation and PII filtering
- Configurable via environment variables

**Configuration**:
```env
AI_PROVIDER=openai          # or 'gemini'
AI_API_KEY=sk-...           # Your API key
AI_MODEL=gpt-4              # Model name
```

**Methods**:
- `generateResponse(prompt, context)`: Generate AI response
- `validateResponse(response)`: Validate and filter PII
- `buildSystemPrompt(context)`: Create context-aware system prompt

---

### 2. **Context Builder Service** (`context-builder.service.ts`)

**Purpose**: Extract and prepare tenant-scoped data for AI queries

**Key Features**:
- Intelligent time range extraction from natural language
- Entity recognition (invoices, payments, customers, etc.)
- Automatic PII redaction
- Tenant data isolation

**Time Range Parsing**:
- "today" → Current day
- "this week" → Current week
- "this month" → Current month
- "Q1", "Q2", "Q3", "Q4" → Respective quarters
- Default: Last 30 days

**PII Redaction**:
- Email addresses → `[REDACTED_EMAIL]`
- Phone numbers → `[REDACTED_PHONE]`
- SSN → `[REDACTED_SSN]`

---

### 3. **Anomaly Detection Service** (`anomaly-detection.service.ts`)

**Purpose**: Detect financial anomalies using statistical analysis

**Anomaly Types**:
1. **Expense Spikes**: Vendor expenses > 2 standard deviations above average
2. **Duplicate Invoices**: Same customer + amount within 30 days
3. **Unusual Payments**: Payments > 3 standard deviations from mean

**Severity Calculation**:
- `critical`: > 3x average
- `high`: > 2x average
- `medium`: > 1x average
- `low`: < 1x average

**Output**:
```json
{
  "anomalies": [
    {
      "id": "uuid",
      "type": "expense_spike",
      "severity": "high",
      "score": 0.85,
      "description": "Unusual expense spike for Vendor A",
      "explanation": "Expense of $15,000 is 250% higher than average",
      "affectedEntity": {
        "type": "vendor",
        "id": "vendor-123",
        "name": "Vendor A"
      },
      "metadata": { ... }
    }
  ],
  "totalCount": 5,
  "highSeverityCount": 2
}
```

---

### 4. **Analytics Service** (`analytics.service.ts`)

**Purpose**: Generate descriptive analytics and insights

**Capabilities**:
- Revenue by month/quarter with profit margins
- Expense breakdown by category with trends
- Cash position analysis (AR, AP, net position)
- AI-generated insights

**Example Insights**:
- "⚠️ Profit margin is low at 8.5%. Consider cost optimization."
- "🔴 Operating at a loss of $5,234.50 this month."
- "📊 Payroll accounts for 45.2% of expenses."

---

### 5. **Knowledge Graph Service** (`knowledge-graph.service.ts`)

**Purpose**: Map entity relationships for contextual understanding

**Entity Types**:
- `CUSTOMER`: Customer records
- `INVOICE`: Invoice documents
- `PAYMENT`: Payment transactions
- `ASSET`: Company assets
- `VENDOR`: Vendor relationships
- `PRODUCT`: Product catalog

**Relationship Types**:
- `HAS_INVOICE`: Customer → Invoice
- `MADE_PAYMENT`: Customer → Payment
- `OWNS_ASSET`: Customer → Asset
- `PURCHASED_FROM`: Invoice → Vendor
- `RELATED_TO`: Generic relationship

**Use Cases**:
- "Show all invoices for Customer X"
- "Find payments related to Invoice Y"
- "What assets does Customer Z own?"

---

### 6. **Chat Service** (`chat.service.ts`)

**Purpose**: Orchestrate conversational AI with session management

**Features**:
- Session-based conversations
- Multi-format responses (text, charts, tables, CSV)
- Automatic data visualization
- Feedback collection
- CSV export

**Response Formats**:
```json
{
  "sessionId": "uuid",
  "response": "Here's your Q3 profit analysis...",
  "format": "chart",
  "charts": [
    {
      "type": "line",
      "title": "Revenue by Month",
      "data": [...],
      "xAxis": "period",
      "yAxis": "revenue"
    }
  ],
  "tables": [
    {
      "title": "Revenue Details",
      "headers": ["Period", "Revenue", "Expenses"],
      "rows": [...]
    }
  ],
  "links": [
    {
      "text": "View Full Dashboard",
      "url": "/dashboard/finance",
      "type": "dashboard"
    }
  ],
  "confidence": 0.92,
  "timestamp": "2024-02-07T..."
}
```

---

## 🔒 Security & Guardrails

### Rate Limiting

**Implementation**: `rate-limit.guard.ts`

**Limits by Tier**:
- **Free Plan**: 10 requests/minute
- **Enterprise Plan**: 100 requests/minute

**Response Headers**:
```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 87
X-RateLimit-Reset: 1707345600000
```

**Error Response**:
```json
{
  "statusCode": 429,
  "message": "Rate limit exceeded. Try again in 45 seconds.",
  "limit": 100,
  "window": 60,
  "resetIn": 45
}
```

### PII Protection

**Automatic Redaction**:
- Email addresses
- Phone numbers
- Social Security Numbers
- Credit card numbers

**Validation**:
- All LLM responses validated before returning
- Profanity filtering (configurable)
- Sensitive content detection

---

## 📡 API Endpoints

### Chat Endpoints

#### 1. Send Chat Query
```http
POST /api/ai/chat
Authorization: Bearer {tenant_token}
Content-Type: application/json

{
  "query": "Show Q3 profit by product",
  "sessionId": "optional-session-id",
  "preferredFormat": "chart"
}
```

**Response**: `ChatResponseDto` with text, charts, tables, and links

---

#### 2. Submit Feedback
```http
POST /api/ai/chat/feedback
Authorization: Bearer {tenant_token}

{
  "sessionId": "uuid",
  "messageId": "uuid",
  "rating": "helpful",
  "comment": "Very accurate analysis"
}
```

---

#### 3. Export to CSV
```http
GET /api/ai/chat/export/{sessionId}/{messageId}
Authorization: Bearer {tenant_token}
```

**Response**: CSV file download

---

### Analytics Endpoints

#### 4. Revenue Analytics
```http
GET /api/ai/analytics/revenue?startDate=2024-01-01&endDate=2024-12-31&groupBy=month
Authorization: Bearer {tenant_token}
```

**Response**:
```json
[
  {
    "period": "2024-01-01",
    "revenue": 125000.00,
    "expenses": 85000.00,
    "profit": 40000.00,
    "margin": 32.0
  }
]
```

---

#### 5. Expense Breakdown
```http
GET /api/ai/analytics/expenses?startDate=2024-01-01&endDate=2024-12-31
Authorization: Bearer {tenant_token}
```

**Response**:
```json
[
  {
    "category": "Payroll",
    "amount": 45000.00,
    "percentage": 52.9,
    "trend": "up"
  }
]
```

---

#### 6. Cash Position
```http
GET /api/ai/analytics/cash-position
Authorization: Bearer {tenant_token}
```

**Response**:
```json
{
  "date": "2024-02-07T...",
  "cashOnHand": 125000.00,
  "accountsReceivable": 45000.00,
  "accountsPayable": 32000.00,
  "netPosition": 138000.00
}
```

---

#### 7. AI Insights
```http
GET /api/ai/analytics/insights
Authorization: Bearer {tenant_token}
```

**Response**:
```json
[
  "⚠️ Profit margin is low at 8.5%. Consider cost optimization.",
  "📊 Payroll accounts for 52.9% of expenses."
]
```

---

### Anomaly Endpoints

#### 8. Detect Anomalies
```http
GET /api/ai/anomalies
Authorization: Bearer {tenant_token}
```

**Response**: `AnomalyDetectionResult`

---

#### 9. Explain Anomaly
```http
GET /api/ai/anomalies/{anomalyId}/explain
Authorization: Bearer {tenant_token}
```

**Response**: Detailed explanation string

---

### Knowledge Graph Endpoints

#### 10. Get Knowledge Graph
```http
GET /api/ai/knowledge-graph
Authorization: Bearer {tenant_token}
```

**Response**: Array of `KnowledgeGraphEntity`

---

#### 11. Get Related Entities
```http
GET /api/ai/knowledge-graph/{entityType}/{entityId}
Authorization: Bearer {tenant_token}
```

**Example**: `/api/ai/knowledge-graph/customer/cust-123`

---

## 🧪 Testing

### Example Test Scenarios

#### Scenario 1: Revenue Analysis
```bash
curl -X POST http://localhost:3000/api/ai/chat \
  -H "Authorization: Bearer $TENANT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "Show Q3 profit by product"
  }'
```

**Expected**: Chart + table with Q3 revenue breakdown

---

#### Scenario 2: Anomaly Investigation
```bash
# 1. Detect anomalies
curl -X GET http://localhost:3000/api/ai/anomalies \
  -H "Authorization: Bearer $TENANT_TOKEN"

# 2. Ask about specific anomaly
curl -X POST http://localhost:3000/api/ai/chat \
  -H "Authorization: Bearer $TENANT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "Why did Vendor A spike in Q2?"
  }'
```

---

#### Scenario 3: Cash Flow Query
```bash
curl -X POST http://localhost:3000/api/ai/chat \
  -H "Authorization: Bearer $TENANT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "What is my current cash position?"
  }'
```

---

## 📊 Performance Metrics

### Target Performance

| Metric | Target | Implementation |
|--------|--------|----------------|
| Chat Response Time | < 2s | Caching + precomputed summaries |
| Analytics Query | < 500ms | Indexed queries + materialized views |
| Anomaly Detection | < 1s | Batch processing + caching |
| Rate Limit | Tier-based | In-memory guard with headers |

### Optimization Strategies

1. **Caching**:
   - Session data cached in-memory
   - Analytics results cached for 5 minutes
   - Knowledge graph cached per tenant

2. **Query Optimization**:
   - Indexed tenant_id columns
   - Materialized views for common aggregations
   - Query result pagination

3. **LLM Optimization**:
   - Prompt template caching
   - Response streaming (future)
   - Model version management

---

## 🔄 Auditability & Logging

### Logged Events

1. **Chat Queries**:
   - Timestamp, tenant, user, query, response
   - Session ID, confidence score
   - Feedback ratings

2. **Anomaly Detection**:
   - Detection timestamp
   - Anomaly type, severity, score
   - Affected entities

3. **PII Redaction**:
   - Redaction events
   - Pattern matches
   - Context preservation

4. **Rate Limiting**:
   - Exceeded limits
   - Tenant, endpoint, timestamp

### Log Format
```json
{
  "timestamp": "2024-02-07T10:30:00Z",
  "level": "info",
  "service": "ai-chat",
  "tenantId": "tenant-123",
  "userId": "user-456",
  "event": "chat_query",
  "data": {
    "query": "Show revenue",
    "sessionId": "session-789",
    "responseTime": 1250,
    "confidence": 0.92
  }
}
```

---

## 🚀 Deployment

### Environment Variables

```env
# AI Configuration
AI_PROVIDER=openai                    # or 'gemini'
AI_API_KEY=sk-...                     # Your API key
AI_MODEL=gpt-4                        # Model name

# Rate Limiting
RATE_LIMIT_FREE_REQUESTS=10           # Free tier limit
RATE_LIMIT_FREE_WINDOW=60000          # Window in ms
RATE_LIMIT_ENTERPRISE_REQUESTS=100    # Enterprise limit
RATE_LIMIT_ENTERPRISE_WINDOW=60000    # Window in ms

# Caching
CACHE_TTL=300                         # Cache TTL in seconds
ENABLE_QUERY_CACHE=true               # Enable query caching

# Logging
LOG_LEVEL=info                        # Log level
ENABLE_AUDIT_LOGS=true                # Enable audit logging
```

### Installation

```bash
# Install dependencies
npm install

# Run migrations (if needed)
npm run migration:run

# Start application
npm run start:dev
```

---

## 📈 Monitoring

### Key Metrics to Monitor

1. **API Performance**:
   - Response times (p50, p95, p99)
   - Error rates
   - Rate limit hits

2. **LLM Usage**:
   - Token consumption
   - API costs
   - Response quality (via feedback)

3. **Anomaly Detection**:
   - Anomalies detected per day
   - False positive rate
   - User engagement with anomalies

4. **User Engagement**:
   - Chat sessions per day
   - Average session length
   - Feedback ratings

---

## 🔮 Future Enhancements

### Phase 2 (Month 3+)

1. **Advanced Analytics**:
   - Predictive analytics (forecasting)
   - Trend analysis with ML models
   - Custom report generation

2. **Enhanced Knowledge Graph**:
   - Graph database integration (Neo4j)
   - Complex relationship queries
   - Visual graph explorer

3. **Multi-modal AI**:
   - Document analysis (OCR)
   - Image recognition for receipts
   - Voice interface

4. **Collaboration**:
   - Shared chat sessions
   - Team insights
   - Annotation and comments

---

## 📚 Code Complete Principles Applied

### 1. **Modularity**
- Each service has single responsibility
- Clear interfaces between components
- Easy to test and maintain

### 2. **Error Handling**
- Comprehensive try-catch blocks
- Meaningful error messages
- Graceful degradation

### 3. **Security First**
- PII redaction at multiple layers
- Rate limiting per tenant
- Input validation on all endpoints

### 4. **Performance**
- Efficient database queries
- Caching strategies
- Async/await patterns

### 5. **Maintainability**
- Clear naming conventions
- Comprehensive documentation
- Type safety with TypeScript

### 6. **Testability**
- Dependency injection
- Mock-friendly interfaces
- Unit test ready

---

## 🆘 Troubleshooting

### Common Issues

#### 1. Rate Limit Errors
**Problem**: `429 Too Many Requests`
**Solution**: Upgrade subscription plan or wait for rate limit reset

#### 2. LLM API Errors
**Problem**: `LLM generation failed`
**Solution**: Check API key, quota, and provider status

#### 3. Slow Responses
**Problem**: Chat responses > 2s
**Solution**: Enable caching, optimize queries, check database indexes

#### 4. PII Leakage
**Problem**: Sensitive data in responses
**Solution**: Review redaction patterns, update validation rules

---

## 📞 Support

For issues or questions:
- GitHub Issues: [repository-url]/issues
- Email: support@example.com
- Documentation: [docs-url]

---

## ✅ Month 2 Completion Status

**Completed Features**:
- ✅ LLM integration (OpenAI/Gemini)
- ✅ Context builder with PII redaction
- ✅ Anomaly detection (3 types)
- ✅ Knowledge graph scaffolding
- ✅ Chat interface with sessions
- ✅ Analytics endpoints
- ✅ Rate limiting
- ✅ Feedback loop
- ✅ CSV export support
- ✅ Audit logging

**Completion**: 100% ✨

---

**Last Updated**: February 2024
**Version**: 2.0.0
**Author**: ERP Middleware Team
