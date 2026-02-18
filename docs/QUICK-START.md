# 🚀 SECURITY SPRINT QUICK START

**Goal**: Move from 40% compliance to 85% (pilot-ready) in 21 days

---

## ⚡ IMMEDIATE ACTIONS (Day 1)

### 1. Install Dependencies (15 minutes)

```bash
# Make script executable
chmod +x install-security-deps.sh

# Run installation
./install-security-deps.sh

# Install Python tools
pip install trufflehog sqlmap

# Pull Docker images
docker pull owasp/zap2docker-stable
```

### 2. Set Up AWS Infrastructure (2 hours)

#### A. Create KMS Key
```bash
# Create Customer Master Key
aws kms create-key \
  --description "ERP Middleware Master Encryption Key" \
  --key-usage ENCRYPT_DECRYPT \
  --origin AWS_KMS \
  --multi-region

# Save the KeyId from output
export KMS_KEY_ID="<KEY_ID_FROM_OUTPUT>"

# Create alias
aws kms create-alias \
  --alias-name alias/erp-cmk \
  --target-key-id $KMS_KEY_ID

# Configure key policy
aws kms put-key-policy \
  --key-id $KMS_KEY_ID \
  --policy-name default \
  --policy file://kms-key-policy.json
```

Create `kms-key-policy.json`:
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "Enable IAM User Permissions",
      "Effect": "Allow",
      "Principal": {"AWS": "arn:aws:iam::ACCOUNT_ID:root"},
      "Action": "kms:*",
      "Resource": "*"
    },
    {
      "Sid": "Allow application to use key",
      "Effect": "Allow",
      "Principal": {"AWS": "arn:aws:iam::ACCOUNT_ID:role/erp-api-role"},
      "Action": ["kms:Decrypt", "kms:GenerateDataKey"],
      "Resource": "*"
    }
  ]
}
```

#### B. Create Secrets in Secrets Manager
```bash
# Database password
aws secretsmanager create-secret \
  --name erp/db/password \
  --secret-string "$(openssl rand -base64 32)"

# JWT secret
aws secretsmanager create-secret \
  --name erp/jwt/secret \
  --secret-string "$(openssl rand -hex 32)"

# JWT refresh secret
aws secretsmanager create-secret \
  --name erp/jwt/refresh-secret \
  --secret-string "$(openssl rand -hex 32)"
```

#### C. Update .env
```bash
# Backup current .env
cp .env .env.backup

# Update .env (remove secrets, add AWS config)
cat > .env << 'EOF'
NODE_ENV=production
PORT=3000

# AWS Configuration
AWS_REGION=us-east-1
USE_KMS=true
AWS_KMS_KEY_ID=alias/erp-cmk
USE_SECRETS_MANAGER=true

# Database (host/port only, password from Secrets Manager)
DB_HOST=localhost
DB_PORT=5432
DB_USERNAME=postgres
DB_DATABASE=erp_middleware

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379

# Feature Flags
FEATURE_AI_ENABLED=false
EOF
```

### 3. Run Database Migrations (5 minutes)

```bash
# Run new security migrations
npm run migration:run

# Verify tables created
psql -d erp_middleware -c "\dt" | grep -E "(tenant_encryption_keys|audit_logs)"
```

### 4. Register Audit Interceptor (5 minutes)

Edit `src/app.module.ts`:
```typescript
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AuditInterceptor } from './common/audit/audit.interceptor';
import { AuditLogService } from './common/audit/audit-log.service';

@Module({
  providers: [
    AuditLogService,
    {
      provide: APP_INTERCEPTOR,
      useClass: AuditInterceptor,
    },
    // ... other providers
  ],
})
```

### 5. Test Everything (30 minutes)

```bash
# Start application
npm run start:dev

# Test KMS integration
curl http://localhost:3000/api/health

# Create test tenant
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "SecurePass123!",
    "fullName": "Test User",
    "role": "ADMIN"
  }'

# Login
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "SecurePass123!"
  }'

# Save token
export TOKEN="<access_token_from_response>"

# Create tenant
curl -X POST http://localhost:3000/api/provisioning/organizations \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "companyName": "Test Corp",
    "dataSourceType": "external",
    "subscriptionPlan": "enterprise"
  }'

# Verify audit logs created
psql -d erp_middleware -c "SELECT * FROM audit_logs ORDER BY timestamp DESC LIMIT 10;"

# Verify encryption keys created
psql -d erp_middleware -c "SELECT id, tenant_id, key_version, is_active FROM tenant_encryption_keys;"
```

---

## 📅 WEEK 1 SCHEDULE

### Monday (Day 1)
- ✅ Install dependencies
- ✅ Set up AWS KMS
- ✅ Set up Secrets Manager
- ✅ Run migrations
- ✅ Test basic functionality

### Tuesday (Day 2)
- [ ] Migrate existing tenants to envelope encryption
- [ ] Test key rotation
- [ ] Document key management procedures

### Wednesday (Day 3)
- [ ] Clean git history with BFG Repo-Cleaner
- [ ] Rotate all exposed API keys
- [ ] Set up pre-commit hooks
- [ ] Test secret retrieval

### Thursday (Day 4)
- [ ] Test audit logging on all endpoints
- [ ] Verify chain integrity
- [ ] Test tamper detection
- [ ] Create audit log export script

### Friday (Day 5)
- [ ] Install OWASP ZAP
- [ ] Run automated security scans
- [ ] Document findings

### Weekend (Day 6-7)
- [ ] Manual penetration testing with Burp Suite
- [ ] SQL injection tests
- [ ] Cross-tenant access tests
- [ ] JWT manipulation tests
- [ ] Create pentest report

---

## 📅 WEEK 2 SCHEDULE

### Monday (Day 8)
- [ ] Deploy Amazon ElastiCache
- [ ] Update rate limiting to use Redis
- [ ] Test distributed rate limiting

### Tuesday (Day 9)
- [ ] Configure rate limit alerts
- [ ] Test abuse detection
- [ ] Document rate limiting architecture

### Wednesday (Day 10)
- [ ] Choose monitoring platform (Datadog/CloudWatch)
- [ ] Deploy monitoring agent
- [ ] Create security dashboard

### Thursday (Day 11)
- [ ] Configure all security alerts
- [ ] Set up PagerDuty integration
- [ ] Test alert delivery

### Friday (Day 12)
- [ ] Enable automated database backups
- [ ] Configure point-in-time recovery
- [ ] Set up S3 backup storage

### Weekend (Day 13-14)
- [ ] Run full restore drill
- [ ] Measure recovery time
- [ ] Document RTO/RPO
- [ ] Add ESLint security rules
- [ ] Update CI pipeline with security gates

---

## 📅 WEEK 3 SCHEDULE

### Monday (Day 15)
- [ ] Review incident response runbook with team
- [ ] Schedule tabletop simulation

### Tuesday (Day 16)
- [ ] Run incident response drill
- [ ] Time response
- [ ] Update runbook

### Wednesday (Day 17)
- [ ] Review security documentation with legal
- [ ] Add architecture diagrams
- [ ] Prepare for enterprise review

### Thursday (Day 18)
- [ ] Final documentation review
- [ ] Update with actual AWS resource IDs

### Friday (Day 19)
- [ ] Install Helmet.js
- [ ] Configure CORS whitelist
- [ ] Add request sanitization

### Weekend (Day 20-21)
- [ ] Remove verbose error messages
- [ ] Enable HTTPS-only
- [ ] Practice all 6 live demos
- [ ] Complete CTO review checklist
- [ ] Schedule CTO review meeting

---

## 🎯 SUCCESS METRICS

Track daily progress:

| Metric | Day 1 | Day 7 | Day 14 | Day 21 | Target |
|--------|-------|-------|--------|--------|--------|
| Compliance % | 40% | [ ]% | [ ]% | [ ]% | 85% |
| Critical Blockers | 4 | [ ] | [ ] | [ ] | 0 |
| Pentest Findings | ? | [ ] | [ ] | [ ] | 0 Critical/High |
| Audit Log Coverage | 0% | [ ]% | [ ]% | [ ]% | 100% |
| Secrets in Git | Many | [ ] | [ ] | [ ] | 0 |

---

## 🚨 BLOCKERS & ESCALATION

If you encounter blockers:

1. **AWS Access Issues**
   - Contact: AWS Support
   - Escalate to: CTO

2. **Budget Approval Needed**
   - Estimated cost: $100/month
   - Escalate to: Finance

3. **Resource Constraints**
   - Need: 2 engineers full-time
   - Escalate to: Engineering Manager

4. **Timeline Slippage**
   - If >2 days behind schedule
   - Escalate to: CTO

---

## 📞 DAILY STANDUP

**Time**: 9:00 AM daily  
**Duration**: 15 minutes  
**Format**:
- What I did yesterday
- What I'm doing today
- Blockers
- Risk level: 🟢 Green / 🟡 Yellow / 🔴 Red

---

## ✅ DEFINITION OF DONE

Before marking any task complete:
- [ ] Code written and tested
- [ ] Documentation updated
- [ ] Tests passing
- [ ] Peer reviewed
- [ ] Deployed to staging
- [ ] Verified working

---

## 🎉 COMPLETION CRITERIA

Sprint is complete when:
- [ ] All 4 critical blockers eliminated
- [ ] Penetration test shows 0 critical/high findings
- [ ] Compliance score ≥85%
- [ ] All 6 CTO demos passed
- [ ] Security documentation complete
- [ ] Incident response plan tested

---

**START NOW**: Run `./install-security-deps.sh`

**Questions?** security@company.com

**Good luck! 🚀**
