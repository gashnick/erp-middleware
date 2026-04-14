# WhatsApp Phone Identity - Visual Architecture Guide

## The Problem We Solved

**Before:** Phone was treated as optional metadata

```
├─ User registers with email
├─ User links WhatsApp
├─ No clear phone → tenant → user mapping
└─ Risk: Cross-tenant data confusion
```

**After:** Phone is the primary identity

```
├─ Phone is globally unique
├─ Phone → tenant (via registry)
├─ Tenant → user (via session)
└─ Clear, enforced identity chain
```

## Why Phone First?

WhatsApp messages arrive with **ONLY the phone number**. No JWT, no user ID, no tenant context.

```
┌─────────────────────────────────────────┐
│   Meta WhatsApp Webhook Arrives         │
├─────────────────────────────────────────┤
│ {                                       │
│   "from": "+254711111111",  ← ONLY THIS│
│   "text": "What is balance?"            │
│ }                                       │
│                                         │
│ No JWT, No user_id, No tenant_id       │
│ No context, No headers                  │
└─────────────────────────────────────────┘
```

**We need to establish identity using ONLY the phone number:**

```
Phone: +254711111111
   ↓ Lookup in public.whatsapp_phone_registry
Tenant: da84d885...
Schema: tenant_acme_corporation_2ab18750_9028
User:   c185a4a4...
   ↓ Now we have full context
Access tenant schema safely
```

## The Three-Table Dance

### Table 1: public.whatsapp_otp_requests (Temporary)

```
┌──────────────────────────────────────────────────────┐
│ Table: public.whatsapp_otp_requests                  │
├──────────────────────────────────────────────────────┤
│ Purpose: Store OTP codes during linking              │
│ Lifecycle: 15 minutes (then expires)                 │
│ Key insight: Tied to user_id at creation time        │
└──────────────────────────────────────────────────────┘

Lifecycle:
1. User clicks "Get Code" (authenticated, so we know user_id)
2. INSERT INTO whatsapp_otp_requests {tenant_id, user_id, otp}
3. User sends code via WhatsApp (no auth, only phone)
4. UPDATE ... SET used_at=NOW (atomic, prevents replay)
5. SELECT ... RETURNING user_id ← Back to authenticated context
6. Row expires after 15 min (or user re-generates)
```

### Table 2: public.whatsapp_phone_registry (Bridge)

```
┌──────────────────────────────────────────────────────┐
│ Table: public.whatsapp_phone_registry                │
├──────────────────────────────────────────────────────┤
│ Purpose: Bridge phone → tenant + user mapping        │
│ Lifecycle: Created at link-time, updated if re-link  │
│ Key insight: Immutable bridge for fast lookups       │
└──────────────────────────────────────────────────────┘

Structure:
┌─────────────────────────────────────────┐
│ phone_number (PK): +254711111111        │
│ tenant_id:        da84d885-0753...      │
│ schema_name:      tenant_acme_corp...   │
│ user_id:          c185a4a4-6b53...      │
└─────────────────────────────────────────┘

On every inbound message:
SELECT * FROM public.whatsapp_phone_registry
WHERE phone_number = '+254711111111'
LIMIT 1;
→ We get tenant_id + schema_name + user_id in one lookup!
```

### Table 3: tenant_schema.whatsapp_sessions (State)

```
┌──────────────────────────────────────────────────────────┐
│ Table: tenant_*.whatsapp_sessions (in tenant schema)      │
├──────────────────────────────────────────────────────────┤
│ Purpose: Store conversation state per phone per tenant    │
│ Lifecycle: Created at link, updated on each message       │
│ Key constraint: user_id MUST be NOT NULL after linking    │
└──────────────────────────────────────────────────────────┘

Structure:
┌─────────────────────────────────────────┐
│ phone_number (UNIQUE):  +254711111111   │
│ user_id:                c185a4a4...     │ ← NON-NULL!
│ chat_session_id:        xyz789...       │
│ context:                {...}           │
│ last_message_at:        2026-04-13...   │
└─────────────────────────────────────────┘

Guarantee: user_id MUST be populated
If NOT → Session is broken → Block access
```

## The Request Journey

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    USER SENDS VIA WHATSAPP                                   │
│                      "+254711111111"                                         │
│                    "What is our balance?"                                    │
└────────────────────────────┬────────────────────────────────────────────────┘
                             │
                    ┌────────▼────────┐
                    │   POST Webhook  │
                    │ /api/whatsapp   │
                    │  /webhook       │
                    └────────┬────────┘
                             │
        ┌────────────────────▼────────────────────┐
        │ handleInbound(webhookBody)              │
        │ - Verify signature (HMAC)               │
        │ - Extract message + phone               │
        └────────────────────┬────────────────────┘
                             │
        ┌────────────────────▼────────────────────┐
        │ Is message 6-digit OTP?                 │
        │ /^\d{6}$/.test(text)                    │
        └────────────────────┬────────────────────┘
                    ┌────────┴────────┐
                    │                 │
              YES   │                 │  NO
                    │                 │
        ┌───────────▼────────┐    ┌───┴──────────────────┐
        │ handleOtpSubmit    │    │ Is text "help"?      │
        │ (LINKING PHASE)    │    └──────────┬──────────┘
        └───────────┬────────┘              │
                    │              ┌────────┴────────┐
         ┌──────────▼────────┐    │         │       │
         │ VALIDATE_CONSUME  │    YES       │       NO
         │ OTP_SQL (atomic)  │    │         │       │
         ├──────────────────┤    │    ┌─────▼─────┐
         │ UPDATE            │    │    │ Send help│
         │ SET used_at=NOW   │    │    │ message  │
         │ WHERE otp=$1      │    │    └──────────┘
         │ RETURNING user_id │    │
         │ + tenant_id       │    │
         └──────┬───────────┘    │
                │                │
        ┌───────▼──────────┐     │
        │ Get schema_name  │     │
        │ from tenants     │     │
        │ table            │     │
        └───────┬──────────┘     │
                │                │
        ┌───────▼──────────────────────────┐
        │ Upsert in tenant schema:          │
        │ whatsapp_sessions                 │
        │ {phone, user_id←✅, context}      │
        └───────┬──────────────────────────┘
                │
        ┌───────▼──────────────────────────┐
        │ INSERT public.whatsapp_           │
        │ phone_registry                    │
        │ {phone→tenant+schema+user}        │
        └───────┬──────────────────────────┘
                │
        ┌───────▼──────────────────────────┐
        │ Send: "✅ Phone linked!"          │
        └───────┬──────────────────────────┘
                │
                └─── END (Next message uses registry)

───────────────────────────────────────────────────────────

        ┌────────────────────────────────────────┐
        │ LINKED PHONE MESSAGING (2nd+ message)  │
        └────────────────────┬───────────────────┘
                             │
        ┌────────────────────▼────────────────────┐
        │ handleInbound(webhookBody)              │
        │ - Phone: +254711111111                  │
        │ - Text: "What is balance?"              │
        └────────────────────┬────────────────────┘
                             │
        ┌────────────────────▼────────────────────┐
        │ LOOKUP_PHONE_SQL                        │
        │ SELECT FROM public.whatsapp_            │
        │ phone_registry WHERE phone=$1           │
        └────────────────────┬────────────────────┘
                             │
        ┌────────────────────▼──────────────────────┐
        │ RETURNS: {tenant_id, schema_name,         │
        │           user_id}                        │
        └────────────────────┬──────────────────────┘
                             │
        ┌────────────────────▼──────────────────────┐
        │ Switch to schema + Query session          │
        │ SELECT FROM <schema>.whatsapp_sessions    │
        │ WHERE phone_number=$1                     │
        └────────────────────┬──────────────────────┘
                             │
        ┌────────────────────▼──────────────────────┐
        │ 🔒 STRICT CHECK:                          │
        │ if (!session.user_id) {                   │
        │   BLOCK: "Please re-link"                 │
        │   return                                  │
        │ }                                         │
        └────────────────────┬──────────────────────┘
                             │
        ┌────────────────────▼──────────────────────┐
        │ ✅ User_id verified not NULL               │
        │ routeToLlm(phone, text, session,          │
        │            tenant_id, schema, user_id)    │
        └────────────────────┬──────────────────────┘
                             │
        ┌────────────────────▼──────────────────────┐
        │ runWithTenantContext({                    │
        │   tenant_id, schema, user_id              │
        │ })                                        │
        └────────────────────┬──────────────────────┘
                             │
        ┌────────────────────▼──────────────────────┐
        │ ChatService.handleMessage()               │
        │ - Query tenant data safely                │
        │ - Call LLM with context                   │
        │ - Generate response                       │
        └────────────────────┬──────────────────────┘
                             │
        ┌────────────────────▼──────────────────────┐
        │ sendToMeta(response)                      │
        │ - Call Meta Graph API                     │
        │ - Send message to user's phone            │
        └──────────────────────────────────────────┘
```

## Security Checkpoint Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    INBOUND MESSAGE PROCESSING                            │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  🔓 STEP 1: No authentication yet (webhook is public)                   │
│     ├─ Phone number: +254711111111 ✓                                    │
│     ├─ User ID: ❌ Unknown yet                                           │
│     └─ Tenant ID: ❌ Unknown yet                                        │
│                                                                          │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  🔐 STEP 2: Phone registry lookup                                       │
│     ├─ Query: WHERE phone_number = '+254711111111'                      │
│     ├─ Result: {tenant_id, schema, user_id}                            │
│     ├─ User ID: ✓ Now known (da84d885...)                               │
│     └─ Tenant ID: ✓ Now known (c185a4a4...)                            │
│                                                                          │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  🔐 STEP 3: Session validation in tenant schema                         │
│     ├─ Query tenant schema: WHERE phone = '+254711111111'               │
│     ├─ Retrieved: session {user_id, chat_session_id, ...}              │
│     ├─ Verification: if (session.user_id === null)                     │
│     │   └─ 🚫 BLOCK: Cannot proceed                                     │
│     │      └─ Message: "Please re-link"                                │
│     │      └─ Log: SECURITY: Session missing user_id                   │
│     └─ Verification: if (session.user_id !== null)                     │
│        └─ ✅ PASS: Continue                                             │
│                                                                          │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  🔐 STEP 4: Identity double-check in routeToLlm()                       │
│     ├─ Guard: if (!userId || !session.userId)                          │
│     │   └─ 🚫 BLOCK: Security violation                                 │
│     │      └─ Log: SECURITY VIOLATION: Attempted route without user_id │
│     └─ Guard: if (userId && session.userId)                            │
│        └─ ✅ PASS: Route to LLM                                         │
│                                                                          │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ✅ STEP 5: Context established                                         │
│     ├─ Tenant context: SET                                              │
│     ├─ User ID: VERIFIED & NON-NULL                                    │
│     ├─ Tenant ID: VERIFIED & IMMUTABLE                                 │
│     └─ Schema: SWITCHED & CONFIRMED                                     │
│                                                                          │
│  Now safe to:                                                           │
│  • Query tenant tables                                                  │
│  • Join with user data                                                  │
│  • Call LLM with full context                                          │
│  • Write to chat history                                               │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

## Attack Surface Reduction

### Before (Without Phone-First)

```
❌ RISKY:
└─ User claims a phone number in request
└─ No validation against real phone owner
└─ Could claim other tenants' phones
└─ Could claim other users' phones
└─ Manual linking prone to errors
```

### After (Phone-First Identity)

```
✅ SAFE:
├─ Phone comes from WhatsApp (unforged)
├─ OTP consumption is atomic (replay-proof)
├─ Phone registry is immutable (tampering-proof)
├─ Session user_id is strictly validated (orphan-proof)
├─ Dual validation points (defense-in-depth)
└─ Comprehensive security logging
```

## Data Integrity Contract

```
Contract: "If a message reaches routeToLlm(), user_id is GUARANTEED non-NULL"

Enforced by:
1. At OTP submission:
   ├─ OTP stored WITH user_id (user is authenticated)
   ├─ user_id IS NOT NULL constraint
   └─ Session upserted with user_id populated

2. At message reception:
   ├─ Registry lookup returns user_id or fails
   ├─ Session lookup validates user_id NOT NULL
   └─ Two checks before routeToLlm()

3. In routeToLlm():
   ├─ Third check: if (!userId) → BLOCK
   └─ Guaranteed safe to use user_id

Violation = Security Error (logged as SECURITY_VIOLATION)
```

## Performance Characteristics

```
┌─────────────────────────────────────┐
│ Message Reception Latency Breakdown  │
├─────────────────────────────────────┤
│ Signature verify:        ~1-2ms     │
│ Detect OTP pattern:      ~0.1ms     │
│ Registry lookup:         ~0.5ms     │
│ Session lookup:          ~0.5ms     │
│ User_id validation:      ~0.1ms     │
│ routeToLlm overhead:     ~1-2ms     │
│                          ────────    │
│ Total overhead:          ~3-6ms     │
│                                     │
│ LLM inference:           ~1-5 sec   │
│ Send to Meta:            ~500-1000ms│
└─────────────────────────────────────┘

Negligible compared to LLM latency.
```

## Failure Modes & Recovery

```
┌─────────────────────────────────────────────────────────┐
│ Scenario: OTP Expires Before User Sends It              │
├─────────────────────────────────────────────────────────┤
│ Behavior: VALIDATE_AND_CONSUME_OTP_SQL fails            │
│           (expires_at check)                            │
│ Message:  "Invalid or expired code. Codes valid 15m"   │
│ Recovery: User clicks "Get Code" again in app           │
│ Result:   New OTP generated, process repeats            │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│ Scenario: User Enters Wrong OTP                         │
├─────────────────────────────────────────────────────────┤
│ Behavior: WHERE otp=$1 returns 0 rows                   │
│ Message:  "Invalid or expired code"                     │
│ Recovery: User tries again (or gets new code)           │
│ Result:   No security compromise (OTP not consumed)     │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│ Scenario: Phone Never Linked (Registry Lookup Fails)    │
├─────────────────────────────────────────────────────────┤
│ Behavior: Not in public.whatsapp_phone_registry         │
│ Message:  "Welcome! To get started, link your phone"    │
│ Recovery: User clicks "Get Code" in app                 │
│ Result:   Process starts from Phase 1                   │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│ Scenario: Session Exists But user_id IS NULL (Orphan)   │
├─────────────────────────────────────────────────────────┤
│ Behavior: STRICT CHECK blocks message                   │
│ Message:  "Please re-link your WhatsApp"                │
│ Log:      SECURITY: Session missing user_id             │
│ Recovery: User goes to app → Settings → Re-link         │
│ Result:   New OTP generated, session updated with user  │
└─────────────────────────────────────────────────────────┘
```

## Schema Evolution Path

```
Phase 1: Before
  public.users → No phone_number
  Linking handled manually/outside system

Phase 2: Add phone_number (Current)
  public.users → phone_number ADDED
  New registrations can include phone
  Existing users unaffected (nullable)

Phase 3: Future
  Incentivize phone linking
  Make phone_number required for new users
  Legacy email-only users can maintain access
  Phone becomes primary lookup key
```

## Deployment Checklist

```
Pre-deployment:
□ Backup production database
□ Review migration in staging
□ Test OTP flow end-to-end
□ Verify indexes created correctly
□ Check for any phone_number conflicts

Deployment:
□ Run migration: npm run typeorm migration:run
□ Verify column created: \d public.users
□ Monitor logs for any issues
□ Test webhook endpoint

Post-deployment:
□ Verify phone_number column populated in new users
□ Monitor SECURITY log entries (should be zero initially)
□ Test OTP submission flow
□ Verify linked messages route correctly
□ Run smoke tests on duplicate/invalid phone scenarios
```

## For Future Reference

**If you need to:**

- **Audit OTP usage**: Query public.whatsapp_otp_requests WHERE used_at IS NOT NULL
- **Find orphaned sessions**: SELECT FROM <schema>.whatsapp_sessions WHERE user_id IS NULL
- **Disable a phone**: DELETE FROM public.whatsapp_phone_registry WHERE phone_number = $1
- **Find user by phone**: SELECT \* FROM public.users WHERE phone_number = $1
- **Re-link a phone**: OTP flow handles this (registry is updated)
