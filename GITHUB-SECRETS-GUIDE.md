# GitHub Secrets Configuration Guide

## Overview

GitHub secrets are used to store sensitive information like passwords, API keys, and SSH keys. Some are provided automatically by GitHub, others you must create yourself.

---

## ✅ Automatically Provided by GitHub

These secrets are **already available** - you don't need to create them:

### `GITHUB_TOKEN`
- **What it is**: Automatically generated token for GitHub API access
- **Used for**: Creating releases, commenting on PRs, accessing repository
- **Scope**: Limited to the current repository
- **No action needed**: GitHub provides this automatically in every workflow

---

## 🔧 Secrets You MUST Create Yourself

Go to: `https://github.com/gashnick/erp-middleware/settings/secrets/actions`

Click "New repository secret" for each of these:

### For Deployment (Optional - Only if deploying to servers)

#### 1. **STAGING_HOST**
- **Value**: Your staging server domain or IP
- **Example**: `staging.myapp.com` or `192.168.1.100`
- **Used for**: Connecting to staging server
- **Required**: Only if you have a staging server

#### 2. **STAGING_USER**
- **Value**: SSH username for staging server
- **Example**: `deploy` or `ubuntu` or `root`
- **Used for**: SSH authentication
- **Required**: Only if you have a staging server

#### 3. **STAGING_SSH_KEY**
- **Value**: Private SSH key for staging server
- **How to generate**:
  ```bash
  # On your local machine
  ssh-keygen -t ed25519 -C "github-actions-staging"
  # Save as: ~/.ssh/github_actions_staging
  
  # Copy public key to server
  ssh-copy-id -i ~/.ssh/github_actions_staging.pub user@staging-server
  
  # Copy private key content for GitHub secret
  cat ~/.ssh/github_actions_staging
  ```
- **Used for**: SSH authentication without password
- **Required**: Only if you have a staging server

#### 4. **PROD_HOST**
- **Value**: Your production server domain or IP
- **Example**: `api.myapp.com` or `production-server.com`
- **Used for**: Connecting to production server
- **Required**: Only if you have a production server

#### 5. **PROD_USER**
- **Value**: SSH username for production server
- **Example**: `deploy` or `ubuntu`
- **Used for**: SSH authentication
- **Required**: Only if you have a production server

#### 6. **PROD_SSH_KEY**
- **Value**: Private SSH key for production server
- **How to generate**:
  ```bash
  # Generate separate key for production
  ssh-keygen -t ed25519 -C "github-actions-production"
  # Save as: ~/.ssh/github_actions_production
  
  # Copy public key to server
  ssh-copy-id -i ~/.ssh/github_actions_production.pub user@prod-server
  
  # Copy private key content for GitHub secret
  cat ~/.ssh/github_actions_production
  ```
- **Used for**: SSH authentication without password
- **Required**: Only if you have a production server

### For Production Database

#### 7. **PROD_DATABASE_HOST**
- **Value**: Production database hostname
- **Example**: `db.myapp.com` or `postgres-prod.aws.com`
- **Used for**: Running migrations on production database
- **Required**: Only for production deployments

#### 8. **PROD_DATABASE_PORT**
- **Value**: Database port number
- **Example**: `5432` (default PostgreSQL port)
- **Used for**: Database connection
- **Required**: Only for production deployments

#### 9. **PROD_DATABASE_USER**
- **Value**: Database username
- **Example**: `postgres` or `erp_admin`
- **Used for**: Database authentication
- **Required**: Only for production deployments

#### 10. **PROD_DATABASE_PASSWORD**
- **Value**: Database password
- **Example**: `your-secure-database-password`
- **Used for**: Database authentication
- **Required**: Only for production deployments
- **Security**: Use a strong, unique password

#### 11. **PROD_DATABASE_NAME**
- **Value**: Database name
- **Example**: `erp_middleware`
- **Used for**: Connecting to correct database
- **Required**: Only for production deployments

---

## 🎯 Quick Setup Guide

### Minimal Setup (CI Only - No Deployment)

If you only want **automated testing** (no deployment), you don't need to create ANY secrets!

The CI pipeline will work automatically with just:
- ✅ `GITHUB_TOKEN` (provided by GitHub)

### Basic Setup (With Deployment)

If you want to deploy to servers, create these secrets:

**For Staging:**
1. `STAGING_HOST`
2. `STAGING_USER`
3. `STAGING_SSH_KEY`

**For Production:**
1. `PROD_HOST`
2. `PROD_USER`
3. `PROD_SSH_KEY`
4. `PROD_DATABASE_HOST`
5. `PROD_DATABASE_PORT`
6. `PROD_DATABASE_USER`
7. `PROD_DATABASE_PASSWORD`
8. `PROD_DATABASE_NAME`

---

## 📝 Step-by-Step: Creating Secrets

### 1. Generate SSH Keys

```bash
# For staging
ssh-keygen -t ed25519 -C "github-actions-staging" -f ~/.ssh/github_staging
# Press Enter for no passphrase (required for automation)

# For production
ssh-keygen -t ed25519 -C "github-actions-production" -f ~/.ssh/github_production
# Press Enter for no passphrase
```

### 2. Copy Public Keys to Servers

```bash
# For staging
ssh-copy-id -i ~/.ssh/github_staging.pub deploy@staging-server.com

# For production
ssh-copy-id -i ~/.ssh/github_production.pub deploy@production-server.com
```

### 3. Get Private Key Content

```bash
# For staging
cat ~/.ssh/github_staging
# Copy the entire output (including BEGIN and END lines)

# For production
cat ~/.ssh/github_production
# Copy the entire output
```

### 4. Add Secrets to GitHub

1. Go to: `https://github.com/gashnick/erp-middleware/settings/secrets/actions`
2. Click "New repository secret"
3. Name: `STAGING_SSH_KEY`
4. Value: Paste the private key content
5. Click "Add secret"
6. Repeat for all other secrets

---

## 🔒 Security Best Practices

### SSH Keys
- ✅ Use separate keys for staging and production
- ✅ Use Ed25519 keys (more secure than RSA)
- ✅ Never commit private keys to repository
- ✅ Use no passphrase for automation
- ✅ Rotate keys every 6-12 months

### Database Passwords
- ✅ Use strong, unique passwords (20+ characters)
- ✅ Use password manager to generate
- ✅ Never use same password for staging and production
- ✅ Rotate passwords regularly

### General
- ✅ Only add secrets you actually need
- ✅ Use environment protection rules for production
- ✅ Review secret access logs regularly
- ✅ Remove unused secrets

---

## 🧪 Testing Without Deployment

If you don't have servers yet, you can still use CI/CD for testing:

### What Works Without Secrets:
- ✅ Automated testing on every push
- ✅ Linting
- ✅ Unit tests
- ✅ E2E tests
- ✅ Code coverage
- ✅ Build verification

### What Requires Secrets:
- ❌ Deploying to staging server
- ❌ Deploying to production server
- ❌ Running production database migrations

### Temporary Solution:

Comment out deployment steps in `.github/workflows/cd.yml`:

```yaml
# - name: Deploy to staging
#   run: |
#     echo "Deploying to staging environment..."
#   env:
#     STAGING_HOST: ${{ secrets.STAGING_HOST }}
#     STAGING_USER: ${{ secrets.STAGING_USER }}
#     STAGING_KEY: ${{ secrets.STAGING_SSH_KEY }}
```

---

## 📊 Summary Table

| Secret Name | Required? | When? | How to Get? |
|-------------|-----------|-------|-------------|
| `GITHUB_TOKEN` | ✅ Auto | Always | Provided by GitHub |
| `STAGING_HOST` | ⚠️ Optional | If deploying to staging | Your server domain/IP |
| `STAGING_USER` | ⚠️ Optional | If deploying to staging | Your SSH username |
| `STAGING_SSH_KEY` | ⚠️ Optional | If deploying to staging | Generate with `ssh-keygen` |
| `PROD_HOST` | ⚠️ Optional | If deploying to production | Your server domain/IP |
| `PROD_USER` | ⚠️ Optional | If deploying to production | Your SSH username |
| `PROD_SSH_KEY` | ⚠️ Optional | If deploying to production | Generate with `ssh-keygen` |
| `PROD_DATABASE_HOST` | ⚠️ Optional | If deploying to production | Your database host |
| `PROD_DATABASE_PORT` | ⚠️ Optional | If deploying to production | Usually `5432` |
| `PROD_DATABASE_USER` | ⚠️ Optional | If deploying to production | Your database username |
| `PROD_DATABASE_PASSWORD` | ⚠️ Optional | If deploying to production | Your database password |
| `PROD_DATABASE_NAME` | ⚠️ Optional | If deploying to production | Your database name |

---

## 🎯 Recommended Approach

### Phase 1: CI Only (Now)
- ✅ No secrets needed
- ✅ Automated testing works immediately
- ✅ Focus on development

### Phase 2: Staging Deployment (Later)
- Add staging server secrets
- Test deployment process
- Verify everything works

### Phase 3: Production Deployment (When Ready)
- Add production secrets
- Set up environment protection
- Deploy with confidence

---

## 🆘 Troubleshooting

### "Secret not found" Error
- Check secret name matches exactly (case-sensitive)
- Verify secret is added to repository (not organization)
- Ensure workflow has access to secrets

### SSH Connection Failed
- Verify public key is on server: `cat ~/.ssh/authorized_keys`
- Test SSH manually: `ssh -i ~/.ssh/github_staging user@server`
- Check server firewall allows SSH (port 22)

### Database Connection Failed
- Verify database host is accessible from GitHub Actions
- Check database firewall allows connections
- Test connection string manually

---

## 📞 Need Help?

If you're stuck:
1. Start with CI only (no secrets needed)
2. Add deployment secrets when you have servers
3. Test each secret individually
4. Check GitHub Actions logs for specific errors

Remember: **You only need secrets for deployment. CI/CD testing works without any secrets!**
