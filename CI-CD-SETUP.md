# CI/CD Pipeline Documentation

## Overview

This project uses GitHub Actions for continuous integration and deployment. The pipeline automatically tests, builds, and deploys the application.

## Pipeline Structure

### 1. CI Pipeline (`.github/workflows/ci.yml`)

**Triggers:**
- Push to `main` or `develop` branches
- Pull requests to `main` or `develop` branches

**Jobs:**

#### Test Job
- Sets up PostgreSQL 14 database
- Installs Node.js 18
- Runs linter (`npm run lint`)
- Runs unit tests (`npm run test`)
- Runs E2E tests (`npm run test:e2e`)
- Uploads test coverage to Codecov

#### Build Job
- Builds the application (`npm run build`)
- Uploads build artifacts
- Runs only if tests pass

**Duration:** ~5-10 minutes

---

### 2. CD Pipeline (`.github/workflows/cd.yml`)

**Triggers:**
- Push to `main` branch → Deploy to Staging
- Push tag `v*` → Deploy to Production

**Jobs:**

#### Deploy to Staging
- Builds application
- Deploys to staging environment
- Runs on every push to `main`

#### Deploy to Production
- Builds application
- Runs database migrations
- Deploys to production
- Creates GitHub release
- Runs only on version tags (e.g., `v1.0.0`)

---

## Setup Instructions

### 1. Configure GitHub Secrets

Go to your repository → Settings → Secrets and variables → Actions

Add the following secrets:

**Staging Environment:**
```
STAGING_HOST=staging.your-domain.com
STAGING_USER=deploy
STAGING_SSH_KEY=<your-ssh-private-key>
```

**Production Environment:**
```
PROD_HOST=api.your-domain.com
PROD_USER=deploy
PROD_SSH_KEY=<your-ssh-private-key>
PROD_DATABASE_HOST=your-db-host.com
PROD_DATABASE_PORT=5432
PROD_DATABASE_USER=postgres
PROD_DATABASE_PASSWORD=<secure-password>
PROD_DATABASE_NAME=erp_middleware
```

### 2. Enable GitHub Actions

1. Go to repository → Actions tab
2. Enable workflows if disabled
3. Workflows will run automatically on push/PR

### 3. Configure Environments

1. Go to Settings → Environments
2. Create two environments:
   - `staging`
   - `production`
3. Add protection rules for production:
   - Required reviewers
   - Wait timer (optional)

---

## Docker Setup

### Build Docker Image

```bash
docker build -t erp-middleware:latest .
```

### Run with Docker Compose

```bash
# Start all services
docker-compose up -d

# View logs
docker-compose logs -f app

# Stop services
docker-compose down

# Stop and remove volumes
docker-compose down -v
```

### Environment Variables

Create `.env` file:

```env
JWT_SECRET=your-jwt-secret-key
JWT_REFRESH_SECRET=your-refresh-secret-key
MASTER_ENCRYPTION_KEY=your-32-character-master-key
```

---

## Deployment Workflows

### Deploy to Staging

```bash
# Push to main branch
git push origin main
```

This automatically:
1. Runs all tests
2. Builds application
3. Deploys to staging

### Deploy to Production

```bash
# Create and push version tag
git tag -a v1.0.0 -m "Release version 1.0.0"
git push origin v1.0.0
```

This automatically:
1. Runs all tests
2. Builds application
3. Runs database migrations
4. Deploys to production
5. Creates GitHub release

---

## Manual Deployment

### Using Docker

```bash
# Build image
docker build -t erp-middleware:v1.0.0 .

# Push to registry
docker tag erp-middleware:v1.0.0 your-registry/erp-middleware:v1.0.0
docker push your-registry/erp-middleware:v1.0.0

# Deploy on server
ssh user@server
docker pull your-registry/erp-middleware:v1.0.0
docker-compose up -d
```

### Using PM2

```bash
# On server
npm ci --only=production
npm run build
pm2 start dist/main.js --name erp-middleware
pm2 save
```

---

## Monitoring & Rollback

### Check Deployment Status

```bash
# View GitHub Actions
# Go to: https://github.com/your-username/erp-middleware/actions

# Check application health
curl https://api.your-domain.com/health
```

### Rollback Production

```bash
# Option 1: Revert to previous tag
git tag -d v1.0.1
git push origin :refs/tags/v1.0.1
git push origin v1.0.0

# Option 2: Deploy previous Docker image
docker pull your-registry/erp-middleware:v1.0.0
docker-compose up -d
```

---

## CI/CD Best Practices

### Branch Strategy

```
main (production)
  ↑
develop (staging)
  ↑
feature/* (development)
```

### Workflow

1. Create feature branch: `git checkout -b feature/new-feature`
2. Make changes and commit
3. Push and create PR to `develop`
4. CI runs tests automatically
5. Merge to `develop` → Auto-deploy to staging
6. Test on staging
7. Create PR from `develop` to `main`
8. Merge to `main` → Auto-deploy to staging
9. Create version tag → Auto-deploy to production

### Version Tagging

```bash
# Semantic versioning: MAJOR.MINOR.PATCH
v1.0.0  # Major release
v1.1.0  # Minor release (new features)
v1.1.1  # Patch release (bug fixes)
```

---

## Troubleshooting

### Tests Failing in CI

```bash
# Run tests locally with same environment
DATABASE_HOST=localhost \
DATABASE_PORT=5432 \
DATABASE_USER=postgres \
DATABASE_PASSWORD=postgres \
DATABASE_NAME=erp_middleware_test \
npm run test:e2e
```

### Build Failing

```bash
# Check build locally
npm run build

# Check for TypeScript errors
npm run lint
```

### Deployment Failing

1. Check GitHub Actions logs
2. Verify secrets are configured
3. Test SSH connection manually
4. Check server logs

---

## Performance Optimization

### Cache Dependencies

GitHub Actions automatically caches `node_modules` using:
```yaml
- uses: actions/setup-node@v4
  with:
    cache: 'npm'
```

### Parallel Jobs

Tests and builds run in parallel when possible to reduce CI time.

### Docker Layer Caching

Multi-stage Dockerfile optimizes build time by caching layers.

---

## Security

### Secrets Management

- Never commit secrets to repository
- Use GitHub Secrets for sensitive data
- Rotate secrets regularly
- Use different secrets for staging/production

### Container Security

- Non-root user in Docker container
- Minimal base image (Alpine)
- Regular security updates
- Health checks enabled

---

## Monitoring

### GitHub Actions

- View workflow runs: Repository → Actions
- Download artifacts: Click on workflow run
- View logs: Click on job name

### Application Monitoring

```bash
# Check application logs
docker-compose logs -f app

# Check database logs
docker-compose logs -f postgres

# Monitor resources
docker stats
```

---

## Next Steps

1. ✅ Configure GitHub Secrets
2. ✅ Enable GitHub Actions
3. ✅ Test CI pipeline with a PR
4. ✅ Configure staging environment
5. ✅ Test staging deployment
6. ✅ Configure production environment
7. ✅ Create first production release

---

## Support

For issues with CI/CD:
- Check GitHub Actions logs
- Review this documentation
- Create an issue in the repository
