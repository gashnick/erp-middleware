# WhatsApp Phone Identity - Quick Reference

## What Changed

✅ **Phone Number** is now the primary identity for WhatsApp  
✅ **Strict Enforcement** - No operations without a known user  
✅ **Global Uniqueness** - Phone numbers are unique across all tenants

## The Three Phases

### Phase 1: OTP Generation (Mobile App)

```
User: Settings → WhatsApp → "Get Code"
         ↓
System: INSERT INTO public.whatsapp_otp_requests
        {tenant_id, user_id, otp:'185789', expires_at: +15min}
         ↓
Result: OTP sent to user
```

### Phase 2: OTP Validation (WhatsApp Webhook)

```
User: Sends "185789" via WhatsApp
         ↓
System: UPDATE public.whatsapp_otp_requests SET used_at=NOW
        WHERE otp='185789' AND not expired AND not used
         ↓
        ✅ Returns: {user_id, tenant_id}
         ↓
        1. Get schema_name from tenants
        2. INSERT INTO <schema>.whatsapp_sessions
           {phone, user_id, context}  ← user_id POPULATED
        3. INSERT INTO public.whatsapp_phone_registry
           {phone → tenant_id + schema + user_id}
         ↓
Result: "✅ Phone linked successfully!"
```

### Phase 3: Linked Phone Messages

```
User: Sends "What is balance?" via WhatsApp
         ↓
System: SELECT * FROM public.whatsapp_phone_registry
        WHERE phone_number = '+254711111111'
         ↓
        ✅ Returns: {tenant_id, schema_name, user_id}
         ↓
        SELECT * FROM <schema>.whatsapp_sessions
        WHERE phone_number = '+254711111111'
         ↓
        🔒 STRICT CHECK:
        if (!session.user_id) {
          BLOCK: "Please re-link"
          return
        }
         ↓
        ✅ user_id is guaranteed non-NULL
         ↓
        RouteToLLM(user_id, tenant_id, schema, message)
         ↓
Result: LLM response sent back
```

## Key Tables

| Table                   | Schema | Purpose               | Key Columns                                                          |
| ----------------------- | ------ | --------------------- | -------------------------------------------------------------------- |
| users                   | public | User accounts         | id, **phone_number**, tenant_id, email                               |
| whatsapp_otp_requests   | public | OTP codes             | id, **tenant_id**, **user_id**, otp, expires_at, **used_at**         |
| whatsapp_phone_registry | public | Phone → Tenant bridge | **phone_number** (PK), **tenant_id**, **schema_name**, **user_id**   |
| whatsapp_sessions       | tenant | Session state         | id, **phone_number** (UNIQUE), **user_id**, chat_session_id, context |

## Critical Security Rule

```typescript
// ✅ This is checked in TWO places:

// 1️⃣ In processTextMessage()
if (!session.userId) {
  logger.error('SECURITY: Session missing user_id — BLOCKING');
  sendMessage(phone, 'Please re-link');
  return; // Block access
}

// 2️⃣ In routeToLlm()
if (!userId || !session.userId) {
  logger.error('SECURITY VIOLATION: Attempted to route without user_id');
  return; // Block
}
```

## What Prevents Cross-Tenant Leaks

| Layer    | Protection                                        |
| -------- | ------------------------------------------------- |
| Database | UNIQUE constraint on phone_number in public.users |
| OTP      | Atomic UPDATE prevents replay attacks             |
| Registry | Phone → Tenant mapping is immutable at link-time  |
| Session  | user_id MUST be non-NULL before LLM access        |
| Query    | Schema context set ONLY after phone validation    |

## Migration

```bash
npm run typeorm migration:run
```

This creates:

- `phone_number` column on `public.users`
- UNIQUE index (E.164 format validation)
- CHECK constraint for phone format

## Logs to Watch

```
✅ OTP generated for user {uid} tenant {tid}
✅ Phone +254711111111 linked to user {uid} (tenant {tid})
⚠️  SECURITY: Session missing user_id — BLOCKING
🔍 Inbound WhatsApp from +254711111111
```

## Debugging

### "Phone not registered"

```
→ User hasn't completed OTP linking yet
→ Ask user to: Settings → WhatsApp → Send Code
```

### "Session error — please re-link"

```
→ Session exists but phone not in registry
→ Data integrity issue, require re-link
```

### "Please re-link your WhatsApp" (user_id NULL)

```
→ Session exists but user_id is NULL
→ Security check triggered, user must re-link
→ Check logs for SECURITY:
```

### "Tenant not found"

```
→ OTP references deleted/missing tenant
→ Check public.tenants table
```

## Testing Commands

### Generate OTP (requires auth)

```bash
POST /api/whatsapp/link
Body: {userId: "..."}
```

### Submit OTP (webhook)

```bash
POST /api/whatsapp/webhook
Header: X-Hub-Signature-256: sha256=...
Body: {
  entry: [{
    changes: [{
      value: {
        messages: [{
          from: "+254711111111",
          type: "text",
          text: { body: "185789" }
        }]
      }
    }]
  }]
}
```

### Send linked message (webhook)

```bash
POST /api/whatsapp/webhook
Body: {
  entry: [{
    changes: [{
      value: {
        messages: [{
          from: "+254711111111",
          type: "text",
          text: { body: "What is our balance?" }
        }]
      }
    }]
  }]
}
```

## Files Changed

| File                                                                    | Change                                                  |
| ----------------------------------------------------------------------- | ------------------------------------------------------- |
| `src/database/migrations/system/1705000000016-AddPhoneNumberToUsers.ts` | NEW: Migration for phone_number                         |
| `src/users/entities/user.entity.ts`                                     | ADD: phoneNumber property                               |
| `src/whatsapp/whatsapp.service.ts`                                      | ENHANCE: Strict user_id validation + comprehensive docs |

## For Developers

### Understanding the Flow

1. Every WhatsApp message enters via `/api/whatsapp/webhook`
2. First check: Is it a 6-digit OTP? → handleOtpSubmission()
3. Second check: Is it `help`? → Send welcome message
4. Third check: Look up phone in registry → Get tenant + user
5. **CRITICAL**: Validate session.user_id is NOT NULL
6. Route to LLM with guaranteed identity

### Adding Features

**To add SMS notifications to user phone:**

```typescript
// User phone is now available:
const user = await userRepository.findOne({ phoneNumber });
// Send SMS to user.phoneNumber
```

**To migrate email→WhatsApp:**

```typescript
// Use public.whatsapp_phone_registry to find all linked phones
const linkedPhones = await queryRunner.query(
  'SELECT phone_number FROM public.whatsapp_phone_registry WHERE tenant_id = $1',
  [tenantId],
);
```

**To audit OTP submissions:**

```typescript
// All OTP requests are in public.whatsapp_otp_requests
// used_at IS NOT NULL = successfully validated OTP
SELECT * FROM public.whatsapp_otp_requests
WHERE used_at IS NOT NULL
ORDER BY used_at DESC;
```

## Performance Notes

- **OTP lookup**: Partial index on (otp, tenant_id) WHERE used_at IS NULL → Fast
- **Phone registry lookup**: Direct PK lookup on phone_number → Very fast
- **Session lookup**: UNIQUE index on phone_number → Index lookup
- **User lookup**: Can now query by phone_number if needed

All operations are O(1) index lookups.
