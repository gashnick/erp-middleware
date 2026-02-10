# OAuth2 Authentication Setup Guide

## Overview

The ERP Middleware supports OAuth2 authentication with Google and GitHub providers, allowing users to sign in without creating a password.

## Features

- ✅ Google OAuth2 authentication
- ✅ GitHub OAuth2 authentication
- ✅ Automatic user creation on first login
- ✅ Link OAuth to existing email/password accounts
- ✅ Profile picture sync
- ✅ Seamless tenant provisioning after OAuth login

---

## Setup Instructions

### 1. Google OAuth2 Setup

#### Create Google OAuth2 Credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing one
3. Enable Google+ API:
   - Go to "APIs & Services" → "Library"
   - Search for "Google+ API"
   - Click "Enable"

4. Create OAuth2 credentials:
   - Go to "APIs & Services" → "Credentials"
   - Click "Create Credentials" → "OAuth client ID"
   - Application type: "Web application"
   - Name: "ERP Middleware"
   
5. Configure authorized redirect URIs:
   ```
   Development:
   http://localhost:3000/api/auth/google/callback
   
   Production:
   https://api.your-domain.com/api/auth/google/callback
   ```

6. Copy your credentials:
   - Client ID: `xxxxx.apps.googleusercontent.com`
   - Client Secret: `GOCSPX-xxxxx`

#### Add to Environment Variables

```env
# Google OAuth2
GOOGLE_CLIENT_ID=your-google-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-google-client-secret
GOOGLE_CALLBACK_URL=http://localhost:3000/api/auth/google/callback
```

---

### 2. GitHub OAuth2 Setup

#### Create GitHub OAuth App

1. Go to [GitHub Developer Settings](https://github.com/settings/developers)
2. Click "New OAuth App"
3. Fill in the details:
   - Application name: "ERP Middleware"
   - Homepage URL: `http://localhost:3000` (dev) or `https://your-domain.com` (prod)
   - Authorization callback URL:
     ```
     Development:
     http://localhost:3000/api/auth/github/callback
     
     Production:
     https://api.your-domain.com/api/auth/github/callback
     ```

4. Click "Register application"
5. Copy your credentials:
   - Client ID: `Iv1.xxxxx`
   - Generate a new client secret and copy it

#### Add to Environment Variables

```env
# GitHub OAuth2
GITHUB_CLIENT_ID=your-github-client-id
GITHUB_CLIENT_SECRET=your-github-client-secret
GITHUB_CALLBACK_URL=http://localhost:3000/api/auth/github/callback
```

---

### 3. Frontend URL Configuration

```env
# Frontend URL for OAuth redirects
FRONTEND_URL=http://localhost:3001
```

---

## Complete .env Configuration

```env
# Database
DATABASE_HOST=localhost
DATABASE_PORT=5432
DATABASE_USER=postgres
DATABASE_PASSWORD=your_password
DATABASE_NAME=erp_middleware

# JWT
JWT_SECRET=your-super-secret-jwt-key
JWT_EXPIRES_IN=1h
JWT_REFRESH_SECRET=your-refresh-secret-key
JWT_REFRESH_EXPIRES_IN=7d

# Encryption
MASTER_ENCRYPTION_KEY=your-32-character-master-key

# Application
PORT=3000
NODE_ENV=development

# Google OAuth2
GOOGLE_CLIENT_ID=your-google-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-google-client-secret
GOOGLE_CALLBACK_URL=http://localhost:3000/api/auth/google/callback

# GitHub OAuth2
GITHUB_CLIENT_ID=your-github-client-id
GITHUB_CLIENT_SECRET=your-github-client-secret
GITHUB_CALLBACK_URL=http://localhost:3000/api/auth/github/callback

# Frontend
FRONTEND_URL=http://localhost:3001
```

---

## API Endpoints

### Google OAuth2

**Initiate Login:**
```
GET /api/auth/google
```

**Callback (handled automatically):**
```
GET /api/auth/google/callback
```

### GitHub OAuth2

**Initiate Login:**
```
GET /api/auth/github
```

**Callback (handled automatically):**
```
GET /api/auth/github/callback
```

---

## Usage Flow

### 1. User Clicks "Sign in with Google/GitHub"

Frontend redirects to:
```javascript
window.location.href = 'http://localhost:3000/api/auth/google';
// or
window.location.href = 'http://localhost:3000/api/auth/github';
```

### 2. User Authorizes on Provider

User is redirected to Google/GitHub to authorize the application.

### 3. Callback with Token

After authorization, user is redirected back to frontend:
```
http://localhost:3001/auth/callback?token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

### 4. Frontend Stores Token

```javascript
// Extract token from URL
const urlParams = new URLSearchParams(window.location.search);
const token = urlParams.get('token');

// Store in localStorage
localStorage.setItem('access_token', token);

// Redirect to dashboard
window.location.href = '/dashboard';
```

---

## Frontend Integration Example

### React Example

```typescript
// Login component
import React from 'react';

const LoginPage = () => {
  const handleGoogleLogin = () => {
    window.location.href = `${process.env.REACT_APP_API_URL}/auth/google`;
  };

  const handleGithubLogin = () => {
    window.location.href = `${process.env.REACT_APP_API_URL}/auth/github`;
  };

  return (
    <div>
      <h1>Login</h1>
      <button onClick={handleGoogleLogin}>
        Sign in with Google
      </button>
      <button onClick={handleGithubLogin}>
        Sign in with GitHub
      </button>
    </div>
  );
};

// Callback handler
import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

const AuthCallback = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  useEffect(() => {
    const token = searchParams.get('token');
    
    if (token) {
      localStorage.setItem('access_token', token);
      navigate('/dashboard');
    } else {
      navigate('/login');
    }
  }, [searchParams, navigate]);

  return <div>Authenticating...</div>;
};
```

---

## Database Schema

### Users Table (Updated)

```sql
CREATE TABLE users (
  id UUID PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id),
  email VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255), -- Now nullable for OAuth users
  full_name VARCHAR(255) NOT NULL,
  role VARCHAR(50) DEFAULT 'STAFF',
  status VARCHAR(20) DEFAULT 'active',
  
  -- OAuth fields
  oauth_provider VARCHAR(50), -- 'google' or 'github'
  oauth_provider_id VARCHAR(255), -- Provider's user ID
  profile_picture VARCHAR(500), -- Profile picture URL
  
  last_login_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  deleted_at TIMESTAMP
);

-- Index for OAuth lookups
CREATE INDEX idx_users_oauth_provider_id 
ON users(oauth_provider, oauth_provider_id) 
WHERE oauth_provider IS NOT NULL;
```

---

## Security Considerations

### 1. HTTPS in Production

Always use HTTPS in production:
```env
GOOGLE_CALLBACK_URL=https://api.your-domain.com/api/auth/google/callback
GITHUB_CALLBACK_URL=https://api.your-domain.com/api/auth/github/callback
```

### 2. Validate Redirect URLs

The callback URLs must match exactly what's configured in Google/GitHub.

### 3. Secure Client Secrets

- Never commit client secrets to repository
- Use environment variables
- Rotate secrets regularly
- Use different credentials for dev/staging/production

### 4. CORS Configuration

Ensure your frontend URL is allowed in CORS:
```typescript
// main.ts
app.enableCors({
  origin: process.env.FRONTEND_URL,
  credentials: true,
});
```

---

## Testing

### Manual Testing

1. Start the application:
   ```bash
   npm run start:dev
   ```

2. Open browser and navigate to:
   ```
   http://localhost:3000/api/auth/google
   ```

3. Complete Google/GitHub authorization

4. Verify redirect to frontend with token

### Automated Testing

```bash
# Run OAuth integration tests
npm run test:e2e -- oauth
```

---

## Troubleshooting

### "Redirect URI mismatch" Error

**Problem:** Callback URL doesn't match configured URL

**Solution:**
1. Check Google/GitHub OAuth app settings
2. Ensure callback URL matches exactly (including http/https)
3. Update environment variable if needed

### "Invalid client" Error

**Problem:** Client ID or secret is incorrect

**Solution:**
1. Verify credentials in Google/GitHub console
2. Check environment variables
3. Restart application after changing .env

### User Not Created

**Problem:** OAuth login succeeds but user not in database

**Solution:**
1. Check application logs for errors
2. Verify database connection
3. Check user creation logic in `auth.service.ts`

### Token Not Received

**Problem:** Redirect happens but no token in URL

**Solution:**
1. Check browser console for errors
2. Verify `FRONTEND_URL` is correct
3. Check OAuth callback handler logs

---

## Migration

Run the OAuth migration:

```bash
npm run migration:run
```

This adds:
- `oauth_provider` column
- `oauth_provider_id` column
- `profile_picture` column
- Makes `password_hash` nullable
- Creates index on OAuth fields

---

## Benefits

### For Users
- ✅ No password to remember
- ✅ Faster sign-up process
- ✅ Secure authentication via trusted providers
- ✅ Profile picture automatically synced

### For Developers
- ✅ Reduced password management complexity
- ✅ Better security (delegated to OAuth providers)
- ✅ Social login increases conversion rates
- ✅ Easy to add more providers

---

## Adding More Providers

To add more OAuth providers (Microsoft, LinkedIn, etc.):

1. Install passport strategy:
   ```bash
   npm install passport-microsoft passport-linkedin-oauth2
   ```

2. Create strategy file:
   ```typescript
   // src/auth/strategies/microsoft.strategy.ts
   ```

3. Add to auth module providers

4. Add routes to auth controller

5. Update documentation

---

## Support

For OAuth-related issues:
- Check provider documentation (Google/GitHub)
- Review application logs
- Test with OAuth playground tools
- Create issue in repository

---

## Next Steps

1. ✅ Configure OAuth credentials
2. ✅ Update environment variables
3. ✅ Run migration
4. ✅ Test OAuth flow
5. ✅ Integrate with frontend
6. ✅ Deploy to production
