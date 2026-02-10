# OAuth2 Testing Without Frontend

## Quick Test Guide

Since you don't have a frontend yet, you can test OAuth2 directly in your browser.

---

## Testing Google OAuth

### 1. Start the Application
```bash
npm run start:dev
```

### 2. Open Browser and Navigate to:
```
http://localhost:3000/api/auth/google
```

### 3. Complete Google Authorization

You'll be redirected to Google to sign in and authorize the app.

### 4. Get Your Token

After authorization, you'll see a JSON response:
```json
{
  "success": true,
  "message": "Google authentication successful",
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "uuid",
    "email": "your-email@gmail.com",
    "tenantId": null,
    "role": "ADMIN"
  }
}
```

### 5. Copy the Token

Copy the `access_token` value and use it for API requests:

```bash
export TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."

# Test the token
curl -X GET http://localhost:3000/api/invoices \
  -H "Authorization: Bearer $TOKEN"
```

---

## Testing GitHub OAuth

### 1. Open Browser and Navigate to:
```
http://localhost:3000/api/auth/github
```

### 2. Complete GitHub Authorization

You'll be redirected to GitHub to authorize the app.

### 3. Get Your Token

After authorization, you'll see a JSON response with your token.

---

## What Happens During OAuth

### First Time Login (New User)
1. You authorize with Google/GitHub
2. System creates a new user account automatically
3. Email from OAuth provider is used
4. No password is set (OAuth users don't need passwords)
5. You get an access token
6. You can now create a tenant or join existing one

### Existing User
1. You authorize with Google/GitHub
2. System finds your existing account by email
3. Links OAuth provider to your account
4. You get an access token
5. If you already have a tenant, you get tenant-scoped token

---

## Complete Flow Example

### 1. OAuth Login
```
Browser: http://localhost:3000/api/auth/google
→ Redirects to Google
→ You authorize
→ Returns JSON with token
```

### 2. Create Tenant
```bash
curl -X POST http://localhost:3000/api/provisioning/organizations \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "companyName": "My Company",
    "dataSourceType": "external",
    "subscriptionPlan": "enterprise"
  }'
```

### 3. Use Tenant Token
```bash
# Response includes new tenant token
export TENANT_TOKEN="new-tenant-token-here"

# Create invoice
curl -X POST http://localhost:3000/api/invoices \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TENANT_TOKEN" \
  -d '{
    "customer_name": "Client Corp",
    "amount": 5000,
    "currency": "USD",
    "status": "pending"
  }'
```

---

## Checking OAuth Users in Database

```sql
-- View OAuth users
SELECT 
  id,
  email,
  full_name,
  oauth_provider,
  oauth_provider_id,
  profile_picture,
  created_at
FROM users
WHERE oauth_provider IS NOT NULL;

-- Check if password is null for OAuth users
SELECT 
  email,
  oauth_provider,
  password_hash IS NULL as is_oauth_only
FROM users;
```

---

## Testing Both Login Methods

### OAuth User (No Password)
```
1. Login via: http://localhost:3000/api/auth/google
2. Get token from JSON response
3. Use token for API calls
```

### Email/Password User
```bash
# Register
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "SecurePass123!",
    "fullName": "Test User",
    "role": "ADMIN"
  }'

# Login
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "SecurePass123!"
  }'
```

---

## Troubleshooting

### "Redirect URI mismatch"
**Problem:** Callback URL doesn't match Google/GitHub settings

**Solution:**
1. Check your Google Cloud Console / GitHub OAuth App
2. Ensure callback URL is: `http://localhost:3000/api/auth/google/callback`
3. Make sure it's exactly the same (http vs https, trailing slash, etc.)

### "Invalid client"
**Problem:** Client ID or secret is wrong

**Solution:**
1. Check `.env` file
2. Verify credentials in Google/GitHub console
3. Restart application after changing `.env`

### No JSON Response
**Problem:** Browser shows blank page

**Solution:**
1. Check browser console for errors
2. Check application logs
3. Verify OAuth callback is working

---

## Current Configuration

Your `.env` should have:
```env
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
GOOGLE_CALLBACK_URL=http://localhost:3000/api/auth/google/callback

GITHUB_CLIENT_ID=your-github-client-id
GITHUB_CLIENT_SECRET=your-github-client-secret
GITHUB_CALLBACK_URL=http://localhost:3000/api/auth/github/callback
```

**Configure both providers with your credentials**

---

## Next Steps

1. ✅ Test Google OAuth in browser
2. ✅ Copy token from JSON response
3. ✅ Use token to create tenant
4. ✅ Test API endpoints with OAuth token
5. ⏳ Configure GitHub OAuth (optional)
6. ⏳ Build frontend later (when ready)

---

## Benefits of Testing Without Frontend

- ✅ Faster testing
- ✅ Direct token access
- ✅ Easy to debug
- ✅ Can use curl/Postman
- ✅ No frontend dependencies

When you build a frontend later, just change the callback to redirect instead of returning JSON!
