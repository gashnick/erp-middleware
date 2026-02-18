# 🧪 END-TO-END VALIDATION SUITE

**Purpose**: Enterprise pilot approval validation  
**Mode**: Real API flows only - No mocks  
**Status**: Ready to Execute

---

## PHASE 1: AUTHENTICATION & TENANT PROVISIONING

### Test 1.1: Valid User Registration
```bash
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "qa.test@enterprise.com",
    "password": "SecureP@ssw0rd123!",
    "fullName": "QA Test User",
    "role": "ADMIN"
  }'
```
**Verify**:
- [ ] 201 Created
- [ ] Password NOT in response
- [ ] User ID returned
- [ ] Check DB: password is bcrypt hash

### Test 1.2: Duplicate Email
```bash
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "qa.test@enterprise.com",
    "password": "AnotherP@ss123!",
    "fullName": "Duplicate User",
    "role": "ADMIN"
  }'
```
**Verify**:
- [ ] 409 Conflict
- [ ] Error message clear

### Test 1.3: SQL Injection in Email
```bash
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d "{
    \"email\": \"admin'--@test.com\",
    \"password\": \"Test123!\",
    \"fullName\": \"SQL Inject\",
    \"role\": \"ADMIN\"
  }"
```
**Verify**:
- [ ] 400 Bad Request (validation)
- [ ] No SQL error exposed

### Test 1.4: Login Valid
```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "qa.test@enterprise.com",
    "password": "SecureP@ssw0rd123!"
  }'
```
**Verify**:
- [ ] 200 OK
- [ ] access_token present
- [ ] Save token: `export TOKEN="<token>"`

### Test 1.5: Rate Limiting (101 requests)
```bash
for i in {1..101}; do
  curl -s -w "%{http_code}\n" -o /dev/null \
    -X POST http://localhost:3000/api/auth/login \
    -H "Content-Type: application/json" \
    -d '{"email":"wrong@test.com","password":"wrong"}'
done | grep "429" | wc -l
```
**Verify**:
- [ ] At least 1 request returns 429
- [ ] Check Redis: rate limit counter exists

### Test 1.6: Tenant Creation
```bash
curl -X POST http://localhost:3000/api/provisioning/organizations \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "companyName": "QA Test Corp",
    "dataSourceType": "external",
    "subscriptionPlan": "enterprise"
  }'
```
**Verify**:
- [ ] 201 Created
- [ ] New access_token with tenantId
- [ ] Save: `export TENANT_TOKEN="<token>"`
- [ ] Check DB: tenant_encryption_keys row exists

### Test 1.7: Cross-Tenant Isolation
```bash
# Create second tenant
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "tenant2@test.com",
    "password": "SecureP@ss2!",
    "fullName": "Tenant 2",
    "role": "ADMIN"
  }'

# Login and create tenant
# Save as TENANT2_TOKEN

# Create invoice in Tenant 1
INVOICE=$(curl -X POST http://localhost:3000/api/invoices \
  -H "Authorization: Bearer $TENANT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "customer_name": "Secret Customer",
    "amount": 50000,
    "status": "paid"
  }')

INVOICE_ID=$(echo $INVOICE | jq -r '.id')

# Attempt access with Tenant 2 token
curl -X GET "http://localhost:3000/api/invoices/$INVOICE_ID" \
  -H "Authorization: Bearer $TENANT2_TOKEN"
```
**Verify**:
- [ ] 403 Forbidden or 404 Not Found
- [ ] No data leaked

---

## PHASE 2: DATA INGESTION (ETL)

### Test 2.1: Valid CSV (100 records)
Create `test-100-invoices.csv`:
```csv
customer_name,amount,external_id,status
Customer 1,1000,EXT-001,paid
Customer 2,2000,EXT-002,pending
...
```

```bash
curl -X POST http://localhost:3000/api/etl/ingest \
  -H "Authorization: Bearer $TENANT_TOKEN" \
  -H "Content-Type: application/json" \
  -d @test-100-invoices.json
```
**Verify**:
- [ ] Job ID returned
- [ ] Check status: all synced
- [ ] Measure: records/minute

### Test 2.2: SQL Injection in CSV
```bash
curl -X POST http://localhost:3000/api/etl/ingest \
  -H "Authorization: Bearer $TENANT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "source": "csv_upload",
    "entityType": "invoice",
    "records": [{
      "customer_name": "Test'; DROP TABLE invoices; --",
      "amount": 1000,
      "external_id": "SQL-001",
      "status": "paid"
    }]
  }'
```
**Verify**:
- [ ] Record processed (not rejected)
- [ ] Table still exists
- [ ] Data stored safely

### Test 2.3: Bulk Upload (5000 records)
```bash
# Generate 5000 records
node generate-test-data.js 5000 > bulk-5000.json

# Upload
time curl -X POST http://localhost:3000/api/etl/ingest \
  -H "Authorization: Bearer $TENANT_TOKEN" \
  -H "Content-Type: application/json" \
  -d @bulk-5000.json
```
**Verify**:
- [ ] Completes without timeout
- [ ] Memory usage acceptable
- [ ] No connection pool exhaustion
- [ ] Measure throughput

---

## PHASE 3: ANALYTICS & ANOMALY DETECTION

### Test 3.1: Analytics Endpoint
```bash
curl -X GET http://localhost:3000/api/ai/analytics \
  -H "Authorization: Bearer $TENANT_TOKEN"
```
**Verify**:
- [ ] Revenue by month returned
- [ ] Expense breakdown present
- [ ] Cash position calculated
- [ ] Response time <500ms

### Test 3.2: Anomaly Detection
```bash
# Insert abnormal spike
curl -X POST http://localhost:3000/api/invoices \
  -H "Authorization: Bearer $TENANT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "customer_name": "Huge Customer",
    "amount": 999999999,
    "status": "paid"
  }'

# Trigger anomaly detection
curl -X POST http://localhost:3000/api/ai/detect-anomalies \
  -H "Authorization: Bearer $TENANT_TOKEN"
```
**Verify**:
- [ ] Anomaly detected
- [ ] Confidence score present
- [ ] Saved to ai_insights table

---

## PHASE 4: SECURITY TESTS

### Test 4.1: JWT Manipulation
```bash
# Decode JWT, change role to ADMIN
FAKE_TOKEN="eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJzdWIiOiJhZG1pbiIsInJvbGUiOiJBRE1JTiJ9."

curl -X GET http://localhost:3000/api/invoices \
  -H "Authorization: Bearer $FAKE_TOKEN"
```
**Verify**:
- [ ] 401 Unauthorized

### Test 4.2: SQL Injection Sweep
```bash
# Test all endpoints
for payload in "' OR '1'='1" "'; DROP TABLE users; --" "' UNION SELECT * FROM users--"; do
  curl -X POST http://localhost:3000/api/auth/login \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"test$payload\",\"password\":\"test\"}"
done
```
**Verify**:
- [ ] All return 400/401
- [ ] No SQL errors exposed

---

## PHASE 5: AUDIT VALIDATION

### Test 5.1: Audit Trail
```bash
# Create invoice
INVOICE_ID=$(curl -X POST http://localhost:3000/api/invoices \
  -H "Authorization: Bearer $TENANT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"customer_name":"Audit Test","amount":1000,"status":"paid"}' \
  | jq -r '.id')

# Read it
curl -X GET "http://localhost:3000/api/invoices/$INVOICE_ID" \
  -H "Authorization: Bearer $TENANT_TOKEN"

# Check audit logs
psql -d erp_middleware -c "
  SELECT action, resource_type, resource_id 
  FROM audit_logs 
  WHERE resource_id = '$INVOICE_ID' 
  ORDER BY timestamp;
"
```
**Verify**:
- [ ] CREATE entry exists
- [ ] READ entry exists
- [ ] Hash chain valid

---

## PHASE 6: PERFORMANCE BASELINE

```bash
# Measure latencies
ab -n 1000 -c 10 -H "Authorization: Bearer $TENANT_TOKEN" \
  http://localhost:3000/api/invoices

# Check metrics
curl http://localhost:3000/metrics
```
**Document**:
- P50 latency: ___ms
- P95 latency: ___ms
- Throughput: ___req/s
