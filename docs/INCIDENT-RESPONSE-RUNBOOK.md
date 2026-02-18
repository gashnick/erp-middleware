# 🚨 INCIDENT RESPONSE RUNBOOK

**Version**: 1.0  
**Last Updated**: [DATE]  
**Owner**: Security Team  
**On-Call**: [PAGERDUTY_LINK]

---

## 🎯 OBJECTIVES

- **Detection**: <15 minutes
- **Containment**: <2 hours
- **Notification**: <72 hours (GDPR requirement)
- **Recovery**: <24 hours
- **Post-Mortem**: Within 7 days

---

## 📋 INCIDENT SEVERITY LEVELS

| Level | Description | Response Time | Escalation |
|-------|-------------|---------------|------------|
| **P0 - Critical** | Data breach, system compromise | Immediate | CTO + Legal |
| **P1 - High** | Service outage, failed backups | <30 min | Engineering Lead |
| **P2 - Medium** | Performance degradation | <2 hours | On-call engineer |
| **P3 - Low** | Minor issues, monitoring alerts | <24 hours | Team review |

---

## 🔴 P0: DATA BREACH RESPONSE

### Phase 1: DETECTION (0-15 minutes)

**Triggers:**
- Audit log shows cross-tenant access
- KMS decrypt errors spike
- Failed login attempts >100/min
- Unusual data export activity
- Security researcher report

**Immediate Actions:**
1. **Confirm breach** - Review audit logs, check monitoring dashboards
2. **Start incident timer** - Document exact detection time
3. **Page on-call security lead** - Use PagerDuty
4. **Create incident channel** - Slack: `#incident-[YYYYMMDD-HHMM]`
5. **Activate war room** - Zoom link: [LINK]

**Commands:**
```bash
# Check audit logs for suspicious activity
psql -d erp_middleware -c "
  SELECT * FROM audit_logs 
  WHERE action = 'READ' 
  AND timestamp > NOW() - INTERVAL '1 hour'
  ORDER BY timestamp DESC 
  LIMIT 100;
"

# Check failed login attempts
psql -d erp_middleware -c "
  SELECT user_id, ip_address, COUNT(*) as attempts
  FROM audit_logs
  WHERE action = 'LOGIN' 
  AND metadata->>'statusCode' = '401'
  AND timestamp > NOW() - INTERVAL '1 hour'
  GROUP BY user_id, ip_address
  HAVING COUNT(*) > 10;
"

# Check cross-tenant access attempts
psql -d erp_middleware -c "
  SELECT * FROM audit_logs
  WHERE metadata->>'error' LIKE '%tenant%'
  AND timestamp > NOW() - INTERVAL '1 hour';
"
```

---

### Phase 2: CONTAINMENT (15 min - 2 hours)

**Objective**: Stop the bleeding

**Actions:**
1. **Isolate affected systems**
   ```bash
   # Revoke all active sessions for affected tenant
   redis-cli KEYS "session:tenant:[TENANT_ID]:*" | xargs redis-cli DEL
   
   # Disable affected user accounts
   psql -d erp_middleware -c "
     UPDATE users SET is_active = false 
     WHERE id IN ('[USER_ID_1]', '[USER_ID_2]');
   "
   ```

2. **Block attacker IP addresses**
   ```bash
   # Add to Redis blacklist
   redis-cli SADD ip_blacklist "[ATTACKER_IP]"
   
   # Update WAF rules (if using AWS WAF)
   aws wafv2 update-ip-set \
     --name erp-blacklist \
     --id [IP_SET_ID] \
     --addresses "[ATTACKER_IP]/32"
   ```

3. **Rotate compromised credentials**
   ```bash
   # Rotate KMS keys
   aws kms schedule-key-deletion --key-id [KEY_ID] --pending-window-in-days 7
   aws kms create-key --description "Emergency rotation"
   
   # Rotate database passwords
   aws secretsmanager rotate-secret --secret-id erp/db/password
   
   # Rotate JWT secrets
   aws secretsmanager rotate-secret --secret-id erp/jwt/secret
   ```

4. **Enable enhanced monitoring**
   ```bash
   # Increase log verbosity
   kubectl set env deployment/erp-api LOG_LEVEL=debug
   
   # Enable query logging
   psql -d erp_middleware -c "ALTER SYSTEM SET log_statement = 'all';"
   psql -d erp_middleware -c "SELECT pg_reload_conf();"
   ```

5. **Preserve evidence**
   ```bash
   # Export audit logs
   psql -d erp_middleware -c "
     COPY (SELECT * FROM audit_logs WHERE timestamp > NOW() - INTERVAL '24 hours')
     TO '/tmp/audit_logs_incident_[DATE].csv' CSV HEADER;
   "
   
   # Snapshot database
   aws rds create-db-snapshot \
     --db-instance-identifier erp-prod \
     --db-snapshot-identifier incident-[DATE]
   
   # Export application logs
   kubectl logs -l app=erp-api --since=24h > /tmp/app_logs_incident_[DATE].log
   ```

**Containment Checklist:**
- [ ] Attacker access revoked
- [ ] Affected systems isolated
- [ ] Credentials rotated
- [ ] Evidence preserved
- [ ] Enhanced monitoring enabled
- [ ] Incident commander assigned

---

### Phase 3: FORENSICS (2-8 hours)

**Objective**: Understand what happened

**Investigation Questions:**
1. **What data was accessed?**
   ```sql
   SELECT resource_type, resource_id, COUNT(*) as access_count
   FROM audit_logs
   WHERE user_id = '[ATTACKER_USER_ID]'
   AND action = 'READ'
   GROUP BY resource_type, resource_id
   ORDER BY access_count DESC;
   ```

2. **When did the breach start?**
   ```sql
   SELECT MIN(timestamp) as first_access
   FROM audit_logs
   WHERE user_id = '[ATTACKER_USER_ID]';
   ```

3. **How did they gain access?**
   ```sql
   SELECT * FROM audit_logs
   WHERE user_id = '[ATTACKER_USER_ID]'
   AND action = 'LOGIN'
   ORDER BY timestamp ASC
   LIMIT 1;
   ```

4. **What tenants were affected?**
   ```sql
   SELECT DISTINCT tenant_id
   FROM audit_logs
   WHERE user_id = '[ATTACKER_USER_ID]'
   AND tenant_id IS NOT NULL;
   ```

5. **Was data exfiltrated?**
   ```sql
   SELECT * FROM audit_logs
   WHERE user_id = '[ATTACKER_USER_ID]'
   AND action = 'EXPORT'
   ORDER BY timestamp DESC;
   ```

**Forensics Deliverables:**
- Timeline of events
- List of affected tenants
- List of accessed resources
- Attack vector analysis
- Impact assessment

---

### Phase 4: NOTIFICATION (8-72 hours)

**GDPR Requirement**: Notify within 72 hours of breach discovery

**Internal Notification (Immediate):**
- [ ] CTO
- [ ] CEO
- [ ] Legal counsel
- [ ] Engineering team
- [ ] Customer success team

**External Notification (Within 72 hours):**

**1. Affected Customers**

Email Template:
```
Subject: Security Incident Notification - [Company Name]

Dear [Customer Name],

We are writing to inform you of a security incident that may have affected your data.

WHAT HAPPENED:
On [DATE] at [TIME], we detected unauthorized access to our system. 
Our investigation determined that [DESCRIPTION OF BREACH].

WHAT DATA WAS AFFECTED:
[LIST OF DATA TYPES: invoices, customer names, amounts, etc.]

WHAT WE'RE DOING:
- Immediately revoked attacker access
- Rotated all encryption keys
- Enhanced security monitoring
- Engaged third-party security firm

WHAT YOU SHOULD DO:
- Review your account for suspicious activity
- Change your password immediately
- Enable two-factor authentication
- Monitor for phishing attempts

We take this matter extremely seriously and apologize for any concern this may cause.

For questions, contact: security@[company].com

Sincerely,
[Name], Chief Technology Officer
```

**2. Regulatory Authorities (GDPR)**

If EU data affected, notify:
- Data Protection Authority (DPA)
- Form: [LINK TO DPA NOTIFICATION FORM]
- Deadline: 72 hours from discovery

**3. Public Disclosure**

If >500 customers affected or high-profile breach:
- [ ] Prepare press release
- [ ] Update status page
- [ ] Post on company blog
- [ ] Notify media contacts

---

### Phase 5: RECOVERY (8-24 hours)

**Objective**: Restore normal operations

**Actions:**
1. **Verify containment**
   - Confirm no ongoing unauthorized access
   - Verify all credentials rotated
   - Check audit logs for anomalies

2. **Restore services**
   ```bash
   # Re-enable affected tenants
   psql -d erp_middleware -c "
     UPDATE tenants SET is_active = true 
     WHERE id IN ('[TENANT_ID_1]', '[TENANT_ID_2]');
   "
   
   # Clear rate limit blocks
   redis-cli FLUSHDB
   
   # Restart services
   kubectl rollout restart deployment/erp-api
   ```

3. **Verify data integrity**
   ```bash
   # Check audit log chain
   curl -X GET http://localhost:3000/api/audit/verify-chain \
     -H "Authorization: Bearer [ADMIN_TOKEN]"
   
   # Run data integrity checks
   npm run verify:data-integrity
   ```

4. **Update security controls**
   - Deploy security patches
   - Update WAF rules
   - Enhance monitoring alerts
   - Add new detection rules

**Recovery Checklist:**
- [ ] Services restored
- [ ] Data integrity verified
- [ ] Security controls updated
- [ ] Monitoring enhanced
- [ ] Customers notified
- [ ] Regulatory notification sent

---

### Phase 6: POST-MORTEM (Within 7 days)

**Objective**: Learn and improve

**Post-Mortem Meeting Agenda:**
1. Timeline review
2. Root cause analysis
3. What went well
4. What went wrong
5. Action items

**Post-Mortem Document Template:**

```markdown
# Incident Post-Mortem: [INCIDENT_ID]

**Date**: [DATE]
**Severity**: P0
**Duration**: [X] hours
**Impact**: [X] customers, [X] records

## SUMMARY
[Brief description of incident]

## TIMELINE
- [TIME]: Detection
- [TIME]: Containment
- [TIME]: Notification
- [TIME]: Recovery

## ROOT CAUSE
[Detailed analysis of how breach occurred]

## IMPACT
- Customers affected: [X]
- Data accessed: [LIST]
- Financial impact: $[X]
- Reputational impact: [ASSESSMENT]

## WHAT WENT WELL
- [Item 1]
- [Item 2]

## WHAT WENT WRONG
- [Item 1]
- [Item 2]

## ACTION ITEMS
| Action | Owner | Deadline | Status |
|--------|-------|----------|--------|
| [Action 1] | [Name] | [Date] | [ ] |
| [Action 2] | [Name] | [Date] | [ ] |

## LESSONS LEARNED
[Key takeaways]
```

---

## 🔧 COMMON INCIDENT TYPES

### SQL Injection Attack
**Detection**: Unusual SQL errors in logs, audit log shows suspicious queries  
**Containment**: Block attacker IP, review all queries from that session  
**Recovery**: Patch vulnerable endpoint, add input validation

### Cross-Tenant Data Access
**Detection**: Audit log shows user accessing data from different tenant  
**Containment**: Revoke user session, verify RLS policies  
**Recovery**: Fix authorization logic, add integration tests

### Credential Compromise
**Detection**: Login from unusual location, multiple failed attempts followed by success  
**Containment**: Revoke all sessions, force password reset  
**Recovery**: Enable 2FA, review access logs

### DDoS Attack
**Detection**: Rate limit violations spike, service degradation  
**Containment**: Enable WAF rate limiting, block attacker IPs  
**Recovery**: Scale infrastructure, optimize endpoints

---

## 📞 CONTACT LIST

| Role | Name | Phone | Email |
|------|------|-------|-------|
| CTO | [NAME] | [PHONE] | [EMAIL] |
| Security Lead | [NAME] | [PHONE] | [EMAIL] |
| Legal Counsel | [NAME] | [PHONE] | [EMAIL] |
| PR Manager | [NAME] | [PHONE] | [EMAIL] |
| AWS Support | - | - | [SUPPORT_LINK] |
| PagerDuty | - | - | [PAGERDUTY_LINK] |

---

## 🔗 USEFUL LINKS

- Audit Log Dashboard: [LINK]
- Monitoring Dashboard: [LINK]
- Status Page: [LINK]
- Incident Slack Channel: #security-incidents
- War Room Zoom: [LINK]
- DPA Notification Form: [LINK]

---

## 📝 INCIDENT LOG TEMPLATE

```
INCIDENT ID: INC-[YYYYMMDD]-[XXX]
SEVERITY: [P0/P1/P2/P3]
DETECTED: [YYYY-MM-DD HH:MM:SS UTC]
CONTAINED: [YYYY-MM-DD HH:MM:SS UTC]
RESOLVED: [YYYY-MM-DD HH:MM:SS UTC]

DESCRIPTION:
[What happened]

IMPACT:
[Who/what was affected]

ROOT CAUSE:
[Why it happened]

RESOLUTION:
[How it was fixed]

FOLLOW-UP:
[Action items]
```

---

**This runbook should be reviewed quarterly and updated after each incident.**

**Last Drill**: [DATE]  
**Next Drill**: [DATE]
