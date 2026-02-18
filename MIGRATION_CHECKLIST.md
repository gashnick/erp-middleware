# 🚀 Production Migration Checklist

## Pre-Migration Phase (Week -1)

### Communication
- [ ] Notify all API consumers of upcoming changes (email + dashboard banner)
- [ ] Share migration timeline and breaking changes document
- [ ] Schedule migration window (recommend weekend/low-traffic period)
- [ ] Set up status page for migration updates

### Documentation
- [ ] Publish migration guide with code examples
- [ ] Update API documentation (Swagger/OpenAPI)
- [ ] Create side-by-side comparison (old vs new endpoints)
- [ ] Record video walkthrough of new API

### Infrastructure
- [ ] Set up Redis for rate limiting
- [ ] Configure monitoring for new endpoints
- [ ] Set up alerts for rate limit violations
- [ ] Prepare rollback plan

---

## Week 1: Add New Endpoints (Non-Breaking)

### GraphQL Implementation
- [ ] Install dependencies: `@nestjs/graphql`, `@nestjs/apollo`, `graphql`
- [ ] Create GraphQL module
- [ ] Implement Invoice resolver
- [ ] Implement Order resolver
- [ ] Implement Product resolver (stub)
- [ ] Implement Asset resolver (stub)
- [ ] Test GraphQL playground locally
- [ ] Deploy to staging
- [ ] Run integration tests
- [ ] Deploy to production (parallel to REST)

**Validation**:
```bash
# Test GraphQL endpoint
curl -X POST http://localhost:3000/graphql \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"query": "{ invoices { id customerName amount } }"}'
```

### Orders Module
- [ ] Create Orders module, controller, service
- [ ] Create Order entity
- [ ] Run database migration for orders table
- [ ] Implement POST /orders
- [ ] Implement GET /orders
- [ ] Implement PATCH /orders/{id}/status
- [ ] Write unit tests
- [ ] Write E2E tests
- [ ] Deploy to staging
- [ ] Deploy to production

**Validation**:
```bash
# Create order
curl -X POST http://localhost:3000/api/orders \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"customerName": "Test", "totalAmount": 100, "items": []}'

# Update status
curl -X PATCH http://localhost:3000/api/orders/{id}/status \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"status": "completed"}'
```

### Insights Module
- [ ] Create Insights module
- [ ] Consolidate Finance + AI services
- [ ] Implement GET /insights
- [ ] Implement POST /insights/query
- [ ] Test natural language queries
- [ ] Deploy to staging
- [ ] Deploy to production

**Validation**:
```bash
# Get insights
curl -X GET http://localhost:3000/api/insights \
  -H "Authorization: Bearer $TOKEN"

# Query insights
curl -X POST http://localhost:3000/api/insights/query \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"query": "Show revenue for Q4", "format": "chart"}'
```

### Webhooks Module
- [ ] Create Webhooks module
- [ ] Create Webhook entity
- [ ] Run database migration for webhooks table
- [ ] Implement POST /webhooks/register
- [ ] Implement webhook delivery service
- [ ] Implement signature verification
- [ ] Test webhook delivery
- [ ] Deploy to staging
- [ ] Deploy to production

**Validation**:
```bash
# Register webhook
curl -X POST http://localhost:3000/api/webhooks/register \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"url": "https://example.com/webhook", "events": ["data_synced", "order_status_changed"]}'
```

### Usage Tracking
- [ ] Create Usage module
- [ ] Implement usage tracking interceptor
- [ ] Implement GET /usage
- [ ] Store usage metrics in database
- [ ] Deploy to staging
- [ ] Deploy to production

**Validation**:
```bash
# Get usage stats
curl -X GET http://localhost:3000/api/usage \
  -H "Authorization: Bearer $TOKEN"
```

### Tenant-Aware Rate Limiting
- [ ] Install Redis
- [ ] Create TenantRateLimitGuard
- [ ] Apply to all tenant-scoped controllers
- [ ] Test rate limits per tier (basic: 60, standard: 120, enterprise: 300)
- [ ] Verify rate limit headers in responses
- [ ] Deploy to staging
- [ ] Deploy to production

**Validation**:
```bash
# Test rate limiting
for i in {1..65}; do
  curl -X GET http://localhost:3000/api/invoices \
    -H "Authorization: Bearer $BASIC_TIER_TOKEN" \
    -w "\n%{http_code}\n"
done
# Should see 429 after 60 requests
```

---

## Week 2: Add Deprecation Warnings

### Update Old Endpoints
- [ ] Add `@deprecated` decorator to old routes
- [ ] Add `X-Deprecated` header to responses
- [ ] Add `X-New-Endpoint` header with replacement URL
- [ ] Log usage of deprecated endpoints
- [ ] Send weekly reports to API consumers

**Example**:
```typescript
@Get('finance/dashboard')
@Header('X-Deprecated', 'true')
@Header('X-New-Endpoint', '/api/insights')
@Header('X-Deprecation-Date', '2024-03-15')
async getDashboard() {
  this.logger.warn('Deprecated endpoint accessed: /finance/dashboard');
  // ... existing logic
}
```

### Update Documentation
- [ ] Mark old endpoints as deprecated in Swagger
- [ ] Add migration examples to README
- [ ] Update Postman collection with new endpoints
- [ ] Publish blog post about migration
- [ ] Update SDK/client libraries

---

## Week 3-4: Dual Support Period

### Monitoring
- [ ] Track usage of old vs new endpoints
- [ ] Monitor error rates on new endpoints
- [ ] Track rate limit violations
- [ ] Monitor GraphQL query performance
- [ ] Set up alerts for anomalies

### Support
- [ ] Respond to migration questions in support channels
- [ ] Update migration guide based on feedback
- [ ] Fix bugs in new endpoints
- [ ] Optimize slow queries

### Metrics to Track
```sql
-- Old endpoint usage
SELECT 
  endpoint,
  COUNT(*) as request_count,
  AVG(response_time_ms) as avg_response_time
FROM api_logs
WHERE endpoint LIKE '/finance/dashboard%'
  OR endpoint LIKE '/ai/%'
  OR endpoint LIKE '/provisioning/%'
GROUP BY endpoint
ORDER BY request_count DESC;

-- New endpoint adoption
SELECT 
  endpoint,
  COUNT(*) as request_count
FROM api_logs
WHERE endpoint IN ('/insights', '/graphql', '/orders')
GROUP BY endpoint;
```

---

## Week 5: Remove Old Endpoints

### Final Communication
- [ ] Send final reminder email (1 week before removal)
- [ ] Post announcement on status page
- [ ] Update API documentation to remove old endpoints

### Code Changes
- [ ] Remove deprecated controllers/routes
- [ ] Remove unused services
- [ ] Clean up imports
- [ ] Update tests
- [ ] Run full test suite

### Endpoints to Remove
```typescript
// DELETE these controllers/routes:
- POST /provisioning/organizations → Use POST /tenants
- GET /finance/dashboard → Use GET /insights
- GET /ai/analytics/* → Use GET /insights
- GET /ai/anomalies → Use GET /insights
- POST /ai/chat → Use POST /insights/query
- POST /etl/ingest → Internal only (admin panel)
- GET /quarantine → Internal only (admin panel)
```

### Deployment
- [ ] Deploy to staging
- [ ] Run smoke tests
- [ ] Monitor for 24 hours
- [ ] Deploy to production
- [ ] Monitor for 48 hours

---

## Post-Migration Phase

### Validation
- [ ] Verify all new endpoints working
- [ ] Verify old endpoints return 404
- [ ] Check error rates
- [ ] Check performance metrics
- [ ] Verify rate limiting working correctly

### Documentation
- [ ] Archive old API documentation
- [ ] Update README with final API list
- [ ] Update Postman collection (remove old endpoints)
- [ ] Publish migration completion announcement

### Cleanup
- [ ] Remove deprecated code
- [ ] Remove feature flags
- [ ] Update CI/CD pipelines
- [ ] Archive migration documentation

---

## Rollback Plan

### If Critical Issues Arise

**Scenario 1: New endpoints have bugs**
```bash
# Revert to previous deployment
kubectl rollout undo deployment/erp-middleware

# Or with Docker
docker-compose down
docker-compose up -d --build <previous-tag>
```

**Scenario 2: Rate limiting causing issues**
```typescript
// Temporarily disable rate limiting
@UseGuards(JwtAuthGuard, TenantGuard) // Remove TenantRateLimitGuard
```

**Scenario 3: GraphQL performance issues**
```typescript
// Disable GraphQL module temporarily
@Module({
  imports: [
    // GraphQLModule, // Comment out
  ],
})
```

### Rollback Checklist
- [ ] Identify issue and severity
- [ ] Notify stakeholders
- [ ] Execute rollback procedure
- [ ] Verify old endpoints working
- [ ] Post incident report
- [ ] Schedule post-mortem
- [ ] Fix issues before retry

---

## Success Metrics

### Technical Metrics
- [ ] 100% of new endpoints operational
- [ ] < 1% error rate on new endpoints
- [ ] < 200ms p95 response time
- [ ] Rate limiting working for all tiers
- [ ] Zero data loss during migration

### Business Metrics
- [ ] > 90% of API consumers migrated
- [ ] < 5 support tickets related to migration
- [ ] Zero customer churn due to migration
- [ ] Positive feedback from API consumers

---

## Emergency Contacts

| Role | Name | Contact |
|------|------|---------|
| Tech Lead | [Name] | [Email/Phone] |
| DevOps Lead | [Name] | [Email/Phone] |
| Product Manager | [Name] | [Email/Phone] |
| On-Call Engineer | [Name] | [Email/Phone] |

---

## Sign-Off

- [ ] Backend Team Lead: _________________ Date: _______
- [ ] DevOps Lead: _________________ Date: _______
- [ ] Product Manager: _________________ Date: _______
- [ ] CTO: _________________ Date: _______

---

**Document Version**: 1.0  
**Last Updated**: 2024-02-16  
**Next Review**: Before each phase
