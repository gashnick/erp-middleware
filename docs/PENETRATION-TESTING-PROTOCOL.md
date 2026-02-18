# 🔐 PENETRATION TESTING PROTOCOL

**Version**: 1.0  
**Last Test Date**: [DATE]  
**Next Test Date**: [DATE + 90 days]  
**Tester**: [NAME]

---

## 🎯 TESTING SCOPE

### In-Scope:
- All API endpoints (`/api/*`)
- Authentication mechanisms
- Authorization controls
- Data encryption
- Tenant isolation
- Input validation
- Session management

### Out-of-Scope:
- Physical security
- Social engineering
- Third-party services (AWS, etc.)
- Production environment (use staging only)

---

## 🛠️ TOOLS REQUIRED

1. **OWASP ZAP** - Automated vulnerability scanner
2. **Burp Suite Professional** - Manual testing
3. **SQLMap** - SQL injection testing
4. **JWT Tool** - JWT manipulation
5. **Postman** - API testing
6. **curl** - Command-line testing

---

## 📋 TEST CASES

### 1️⃣ SQL INJECTION TESTING

**Objective**: Verify all inputs are sanitized

**Test Cases:**

#### Test 1.1: Login SQL Injection
```bash
# Attempt SQL injection in email field
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@example.com'\'' OR '\''1'\''='\''1",
    "password": "anything"
  }'

# Expected: 401 Unauthorized (not 200 OK)
# Expected: No SQL error in response
```

#### Test 1.2: Invoice Search SQL Injection
```bash
# Get valid token first
TOKEN="[VALID_TOKEN]"

# Attempt SQL injection in query parameter
curl -X GET "http://localhost:3000/api/invoices?search=test' OR '1'='1" \
  -H "Authorization: Bearer $TOKEN"

# Expected: Empty results or sanitized search (not all invoices)
```

#### Test 1.3: Automated SQLMap Scan
```bash
# Test all POST endpoints
sqlmap -u "http://localhost:3000/api/auth/login" \
  --data='{"email":"test@example.com","password":"test"}' \
  --headers="Content-Type: application/json" \
  --level=5 \
  --risk=3 \
  --batch

# Expected: No SQL injection vulnerabilities found
```

**Pass Criteria**: ✅ No SQL injection possible, all inputs parameterized

---

### 2️⃣ CROSS-TENANT ACCESS TESTING

**Objective**: Verify tenant isolation

**Test Cases:**

#### Test 2.1: Direct Resource Access
```bash
# Create two tenants
TENANT1_TOKEN="[TOKEN_1]"
TENANT2_TOKEN="[TOKEN_2]"

# Create invoice in Tenant 1
INVOICE_RESPONSE=$(curl -X POST http://localhost:3000/api/invoices \
  -H "Authorization: Bearer $TENANT1_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "customer_name": "Secret Customer",
    "amount": 10000,
    "status": "paid"
  }')

INVOICE_ID=$(echo $INVOICE_RESPONSE | jq -r '.id')

# Attempt to access Tenant 1 invoice with Tenant 2 token
curl -X GET "http://localhost:3000/api/invoices/$INVOICE_ID" \
  -H "Authorization: Bearer $TENANT2_TOKEN"

# Expected: 403 Forbidden or 404 Not Found (not 200 OK with data)
```

#### Test 2.2: List Endpoint Isolation
```bash
# List invoices with Tenant 2 token
TENANT2_INVOICES=$(curl -X GET http://localhost:3000/api/invoices \
  -H "Authorization: Bearer $TENANT2_TOKEN")

# Verify Tenant 1 invoice is NOT in results
echo $TENANT2_INVOICES | jq '.[] | select(.id == "'$INVOICE_ID'")'

# Expected: Empty result (no cross-tenant data)
```

#### Test 2.3: Database Query Injection
```bash
# Attempt to bypass tenant filter with query manipulation
curl -X GET "http://localhost:3000/api/invoices?tenant_id=*" \
  -H "Authorization: Bearer $TENANT2_TOKEN"

# Expected: Only Tenant 2 data returned
```

**Pass Criteria**: ✅ Zero cross-tenant data access possible

---

### 3️⃣ JWT MANIPULATION TESTING

**Objective**: Verify JWT security

**Test Cases:**

#### Test 3.1: Algorithm Confusion Attack
```bash
# Get valid JWT
TOKEN="[VALID_JWT]"

# Decode JWT
echo $TOKEN | cut -d'.' -f2 | base64 -d | jq '.'

# Modify algorithm to "none"
HEADER='{"alg":"none","typ":"JWT"}'
PAYLOAD='{"sub":"admin-id","tenantId":"target-tenant","role":"ADMIN"}'

FAKE_TOKEN=$(echo -n "$HEADER" | base64 -u).$(echo -n "$PAYLOAD" | base64 -u).

# Attempt to use fake token
curl -X GET http://localhost:3000/api/invoices \
  -H "Authorization: Bearer $FAKE_TOKEN"

# Expected: 401 Unauthorized
```

#### Test 3.2: Token Expiration Bypass
```bash
# Use expired token
EXPIRED_TOKEN="[EXPIRED_JWT]"

curl -X GET http://localhost:3000/api/invoices \
  -H "Authorization: Bearer $EXPIRED_TOKEN"

# Expected: 401 Unauthorized with "Token expired" message
```

#### Test 3.3: Role Escalation
```bash
# Login as VIEWER
VIEWER_TOKEN="[VIEWER_TOKEN]"

# Manually modify JWT payload to change role to ADMIN
# (Use jwt.io or jwt-cli tool)

# Attempt privileged operation
curl -X DELETE http://localhost:3000/api/invoices/[ID] \
  -H "Authorization: Bearer $MODIFIED_TOKEN"

# Expected: 401 Unauthorized (signature verification fails)
```

**Pass Criteria**: ✅ JWT tampering detected and rejected

---

### 4️⃣ IDOR (Insecure Direct Object Reference) TESTING

**Objective**: Verify authorization on all resources

**Test Cases:**

#### Test 4.1: Sequential ID Enumeration
```bash
# Create invoice and note the ID
INVOICE_ID="12345"

# Try accessing IDs around it
for i in {12340..12350}; do
  curl -s -X GET "http://localhost:3000/api/invoices/$i" \
    -H "Authorization: Bearer $TOKEN" \
    -w "\nStatus: %{http_code}\n"
done

# Expected: Only owned resources return 200, others return 403/404
```

#### Test 4.2: UUID Guessing
```bash
# Attempt to access random UUIDs
curl -X GET "http://localhost:3000/api/invoices/00000000-0000-0000-0000-000000000001" \
  -H "Authorization: Bearer $TOKEN"

# Expected: 404 Not Found (not 403, to avoid information disclosure)
```

**Pass Criteria**: ✅ All resources require proper authorization

---

### 5️⃣ RATE LIMITING BYPASS TESTING

**Objective**: Verify rate limiting works

**Test Cases:**

#### Test 5.1: Brute Force Protection
```bash
# Attempt 200 login requests in 1 minute
for i in {1..200}; do
  curl -X POST http://localhost:3000/api/auth/login \
    -H "Content-Type: application/json" \
    -d '{
      "email": "test@example.com",
      "password": "wrong'$i'"
    }' &
done
wait

# Expected: 429 Too Many Requests after threshold
```

#### Test 5.2: IP Rotation Bypass
```bash
# Attempt to bypass with X-Forwarded-For header
for i in {1..200}; do
  curl -X POST http://localhost:3000/api/auth/login \
    -H "Content-Type: application/json" \
    -H "X-Forwarded-For: 192.168.1.$i" \
    -d '{
      "email": "test@example.com",
      "password": "wrong"
    }'
done

# Expected: Rate limit still enforced (header ignored or validated)
```

**Pass Criteria**: ✅ Rate limiting cannot be bypassed

---

### 6️⃣ MASS ASSIGNMENT TESTING

**Objective**: Verify only allowed fields can be updated

**Test Cases:**

#### Test 6.1: Role Escalation via Mass Assignment
```bash
# Attempt to set role to ADMIN during registration
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "attacker@example.com",
    "password": "SecurePass123!",
    "fullName": "Attacker",
    "role": "ADMIN",
    "isActive": true,
    "tenantId": "target-tenant-id"
  }'

# Expected: Role defaults to lowest privilege (VIEWER or STAFF)
```

#### Test 6.2: Invoice Amount Manipulation
```bash
# Attempt to set is_encrypted flag
curl -X POST http://localhost:3000/api/invoices \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "customer_name": "Test",
    "amount": 100,
    "status": "paid",
    "is_encrypted": false,
    "tenant_id": "different-tenant"
  }'

# Expected: Sensitive fields ignored, set by server
```

**Pass Criteria**: ✅ Only whitelisted fields accepted

---

### 7️⃣ CORS MISCONFIGURATION TESTING

**Objective**: Verify CORS policy is restrictive

**Test Cases:**

#### Test 7.1: Wildcard Origin
```bash
curl -X GET http://localhost:3000/api/invoices \
  -H "Authorization: Bearer $TOKEN" \
  -H "Origin: https://evil.com" \
  -v

# Check response headers
# Expected: Access-Control-Allow-Origin should NOT be * or https://evil.com
```

#### Test 7.2: Credentials with Wildcard
```bash
curl -X OPTIONS http://localhost:3000/api/invoices \
  -H "Origin: https://evil.com" \
  -H "Access-Control-Request-Method: GET" \
  -v

# Expected: If credentials allowed, origin must be specific (not *)
```

**Pass Criteria**: ✅ CORS policy is restrictive

---

### 8️⃣ HEADER INJECTION TESTING

**Objective**: Verify header security

**Test Cases:**

#### Test 8.1: Security Headers Present
```bash
curl -I http://localhost:3000/api/health

# Expected headers:
# X-Content-Type-Options: nosniff
# X-Frame-Options: DENY
# X-XSS-Protection: 1; mode=block
# Strict-Transport-Security: max-age=31536000
# Content-Security-Policy: default-src 'self'
```

#### Test 8.2: Information Disclosure
```bash
curl -I http://localhost:3000/api/health

# Should NOT contain:
# X-Powered-By: Express
# Server: nginx/1.2.3
```

**Pass Criteria**: ✅ All security headers present, no info disclosure

---

## 🤖 AUTOMATED TESTING SCRIPT

Save as `pentest-automated.sh`:

```bash
#!/bin/bash

echo "🔐 Starting Automated Penetration Tests"
echo "========================================"

BASE_URL="http://localhost:3000/api"
RESULTS_FILE="pentest-results-$(date +%Y%m%d-%H%M%S).txt"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m' # No Color

# Test counter
PASSED=0
FAILED=0

test_result() {
  if [ $1 -eq 0 ]; then
    echo -e "${GREEN}✅ PASS${NC}: $2"
    ((PASSED++))
  else
    echo -e "${RED}❌ FAIL${NC}: $2"
    ((FAILED++))
  fi
}

# Test 1: SQL Injection in Login
echo "\n1️⃣ Testing SQL Injection Protection..."
RESPONSE=$(curl -s -w "%{http_code}" -X POST $BASE_URL/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin'\''OR'\''1'\''='\''1","password":"test"}')

HTTP_CODE="${RESPONSE: -3}"
if [ "$HTTP_CODE" = "401" ]; then
  test_result 0 "SQL Injection blocked in login"
else
  test_result 1 "SQL Injection may be possible (got $HTTP_CODE)"
fi

# Test 2: JWT Algorithm Confusion
echo "\n2️⃣ Testing JWT Security..."
FAKE_TOKEN="eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJzdWIiOiJhZG1pbiIsInJvbGUiOiJBRE1JTiJ9."
RESPONSE=$(curl -s -w "%{http_code}" -X GET $BASE_URL/invoices \
  -H "Authorization: Bearer $FAKE_TOKEN")

HTTP_CODE="${RESPONSE: -3}"
if [ "$HTTP_CODE" = "401" ]; then
  test_result 0 "JWT algorithm confusion prevented"
else
  test_result 1 "JWT security may be weak (got $HTTP_CODE)"
fi

# Test 3: Rate Limiting
echo "\n3️⃣ Testing Rate Limiting..."
COUNT=0
for i in {1..150}; do
  HTTP_CODE=$(curl -s -w "%{http_code}" -o /dev/null -X POST $BASE_URL/auth/login \
    -H "Content-Type: application/json" \
    -d '{"email":"test@test.com","password":"wrong"}')
  
  if [ "$HTTP_CODE" = "429" ]; then
    COUNT=$((COUNT + 1))
  fi
done

if [ $COUNT -gt 0 ]; then
  test_result 0 "Rate limiting active (blocked $COUNT requests)"
else
  test_result 1 "Rate limiting not working"
fi

# Test 4: Security Headers
echo "\n4️⃣ Testing Security Headers..."
HEADERS=$(curl -s -I $BASE_URL/health)

if echo "$HEADERS" | grep -q "X-Content-Type-Options"; then
  test_result 0 "X-Content-Type-Options header present"
else
  test_result 1 "X-Content-Type-Options header missing"
fi

if echo "$HEADERS" | grep -q "X-Frame-Options"; then
  test_result 0 "X-Frame-Options header present"
else
  test_result 1 "X-Frame-Options header missing"
fi

# Test 5: Information Disclosure
echo "\n5️⃣ Testing Information Disclosure..."
if echo "$HEADERS" | grep -q "X-Powered-By"; then
  test_result 1 "X-Powered-By header exposes technology stack"
else
  test_result 0 "No X-Powered-By header (good)"
fi

# Summary
echo "\n========================================"
echo "📊 Test Summary"
echo "========================================"
echo -e "${GREEN}Passed: $PASSED${NC}"
echo -e "${RED}Failed: $FAILED${NC}"
echo "Total: $((PASSED + FAILED))"

if [ $FAILED -eq 0 ]; then
  echo -e "\n${GREEN}🎉 All tests passed!${NC}"
  exit 0
else
  echo -e "\n${RED}⚠️  Some tests failed. Review results above.${NC}"
  exit 1
fi
```

---

## 📊 OWASP ZAP AUTOMATED SCAN

```bash
# Start ZAP in daemon mode
docker run -u zap -p 8080:8080 -d owasp/zap2docker-stable zap.sh -daemon \
  -host 0.0.0.0 -port 8080 -config api.disablekey=true

# Wait for ZAP to start
sleep 30

# Run spider scan
curl "http://localhost:8080/JSON/spider/action/scan/?url=http://host.docker.internal:3000"

# Wait for spider to complete
sleep 60

# Run active scan
curl "http://localhost:8080/JSON/ascan/action/scan/?url=http://host.docker.internal:3000"

# Wait for scan to complete (check progress)
while true; do
  PROGRESS=$(curl -s "http://localhost:8080/JSON/ascan/view/status/" | jq -r '.status')
  echo "Scan progress: $PROGRESS%"
  if [ "$PROGRESS" = "100" ]; then
    break
  fi
  sleep 10
done

# Generate HTML report
curl "http://localhost:8080/OTHER/core/other/htmlreport/" > zap-report.html

echo "✅ ZAP scan complete. Report saved to zap-report.html"
```

---

## 📝 FINDINGS TEMPLATE

```markdown
## Finding: [TITLE]

**Severity**: Critical / High / Medium / Low  
**CVSS Score**: [X.X]  
**CWE**: [CWE-XXX]

### Description
[What is the vulnerability]

### Impact
[What could an attacker do]

### Steps to Reproduce
1. [Step 1]
2. [Step 2]
3. [Step 3]

### Proof of Concept
```bash
[Command or code]
```

### Affected Endpoints
- `/api/endpoint1`
- `/api/endpoint2`

### Remediation
[How to fix it]

### References
- [OWASP Link]
- [CWE Link]

### Status
- [ ] Identified
- [ ] Fixed
- [ ] Retested
- [ ] Verified
```

---

## ✅ SIGN-OFF CHECKLIST

- [ ] All test cases executed
- [ ] OWASP ZAP scan completed
- [ ] Burp Suite manual testing completed
- [ ] All critical/high findings fixed
- [ ] All findings documented
- [ ] Retest completed
- [ ] Report generated
- [ ] CTO approval obtained

---

**Tester Signature**: _______________  
**Date**: _______________  
**CTO Approval**: _______________  
**Date**: _______________
