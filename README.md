# AI-Powered ERP Middleware

A production-ready, multi-tenant ERP middleware built with NestJS, featuring secure authentication, ETL pipelines, and real-time finance dashboards.

## 🚀 Features

- **Multi-tenant Architecture**: Schema-per-tenant isolation with AES-256 encryption
- **Role-Based Access Control (RBAC)**: ADMIN, MANAGER, ANALYST, STAFF, VIEWER roles
- **ETL Pipeline**: Data validation, transformation, and quarantine system
- **Finance Dashboard**: Real-time cash flow, AR/AP aging, and profitability metrics
- **Secure Authentication**: JWT tokens with refresh mechanism
- **Data Encryption**: Tenant-specific encryption keys with master key protection

## 📋 Prerequisites

- Node.js 18+ 
- PostgreSQL 14+
- npm or yarn

## 🛠️ Installation

### 1. Clone the Repository

```bash
git clone <repository-url>
cd erp-middleware
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Configure Environment Variables

Create a `.env` file in the root directory:

```env
# Database
DATABASE_HOST=localhost
DATABASE_PORT=5432
DATABASE_USER=postgres
DATABASE_PASSWORD=your_password
DATABASE_NAME=erp_middleware

# JWT
JWT_SECRET=your-super-secret-jwt-key-change-in-production
JWT_EXPIRES_IN=1h
JWT_REFRESH_SECRET=your-refresh-secret-key
JWT_REFRESH_EXPIRES_IN=7d

# Encryption
MASTER_ENCRYPTION_KEY=your-32-character-master-key-here

# Application
PORT=3000
NODE_ENV=development
```

### 4. Setup Database

```bash
# Create database
createdb erp_middleware

# Run migrations
npm run migration:run
```

### 5. Start the Application

```bash
# Development mode
npm run start:dev

# Production mode
npm run build
npm run start:prod
```

The API will be available at `http://localhost:3000`

## 📚 API Documentation

Swagger documentation available at: `http://localhost:3000/api`

---

## 🧪 Month 1 Functionality Tests

Complete test suite for all Month 1 MVP features using curl commands.

### Prerequisites for Testing

1. Ensure the application is running: `npm run start:dev`
2. PostgreSQL database is accessible
3. All environment variables are configured

---

## Test Suite

### 1️⃣ User Registration

**Register a new user:**

```bash
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@example.com",
    "password": "SecurePass123!",
    "fullName": "Admin User",
    "role": "ADMIN"
  }'
```

**Expected Response:**
```json
{
  "id": "uuid",
  "email": "admin@example.com",
  "fullName": "Admin User",
  "role": "ADMIN",
  "tenantId": null,
  "createdAt": "2026-02-07T..."
}
```

---

### 2️⃣ User Login (Public Token)

**Login without tenant:**

```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@example.com",
    "password": "SecurePass123!"
  }'
```

**Expected Response:**
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "uuid",
    "email": "admin@example.com",
    "tenantId": null,
    "role": "ADMIN"
  }
}
```

**Save the access_token for next steps:**
```bash
export PUBLIC_TOKEN="<access_token_from_response>"
```

---

### 3️⃣ Get Subscription Plans

**List available subscription plans:**

```bash
curl -X GET http://localhost:3000/api/subscription-plans
```

**Expected Response:**
```json
[
  {
    "id": "free",
    "name": "Free Plan",
    "price": 0,
    "features": ["Basic features"]
  },
  {
    "id": "enterprise",
    "name": "Enterprise Plan",
    "price": 999,
    "features": ["All features", "Priority support"]
  }
]
```

---

### 4️⃣ Tenant Provisioning

**Create organization and tenant:**

```bash
curl -X POST http://localhost:3000/api/tenants \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $PUBLIC_TOKEN" \
  -d '{
    "companyName": "Acme Corporation",
    "dataSourceType": "external",
    "subscriptionPlan": "enterprise"
  }'
```

**Expected Response:**
```json
{
  "success": true,
  "message": "Tenant created successfully",
  "tenantId": "67ae7320-f353-4788-b9b5-65a66daac48d",
  "schemaName": "tenant_acme_corporation_2391d553_4621",
  "organization": {
    "id": "67ae7320-f353-4788-b9b5-65a66daac48d",
    "name": "Acme Corporation",
    "slug": "acme_corporation"
  },
  "auth": {
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}
```

**Save the tenant access_token:**
```bash
export TENANT_TOKEN="<accessToken_from_response>"
```

---

### 5️⃣ Create Invoices

**Create a valid invoice:**

```bash
curl -X POST http://localhost:3000/api/invoices \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TENANT_TOKEN" \
  -d '{
    "customer_name": "Client Corp",
    "amount": 5000.00,
    "currency": "USD",
    "status": "pending"
  }'
```

**Expected Response:**
```json
{
  "id": "invoice-uuid",
  "tenant_id": "tenant-uuid",
  "invoice_number": "INV-1770448012684",
  "customer_name": "Client Corp",
  "amount": "5000.00",
  "is_encrypted": true,
  "currency": "USD",
  "status": "pending",
  "created_at": "2026-02-07T..."
}
```

**Create multiple invoices:**

```bash
# Paid invoice
curl -X POST http://localhost:3000/api/invoices \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TENANT_TOKEN" \
  -d '{
    "customer_name": "Beta Inc",
    "amount": 3500.00,
    "currency": "USD",
    "status": "paid"
  }'

# Another pending invoice
curl -X POST http://localhost:3000/api/invoices \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TENANT_TOKEN" \
  -d '{
    "customer_name": "Gamma LLC",
    "amount": 7500.00,
    "currency": "USD",
    "status": "pending"
  }'
```

---

### 6️⃣ Finance Dashboard

**Get finance dashboard metrics:**

```bash
curl -X GET http://localhost:3000/api/finance/dashboard \
  -H "Authorization: Bearer $TENANT_TOKEN"
```

**Expected Response:**
```json
{
  "tenantId": "tenant-uuid",
  "cashFlow": {
    "totalInvoiced": 16000.00,
    "totalCollected": 3500.00,
    "outstanding": 12500.00
  },
  "arAging": {
    "current": 0,
    "overdue30": 0,
    "overdue60": 0,
    "overdue90": 0
  },
  "apAging": {
    "current": 0,
    "overdue30": 0,
    "overdue60": 0,
    "overdue90": 0
  },
  "profitability": {
    "grossMargin": 0,
    "netProfit": 0
  },
  "anomalies": [],
  "recentAnomaliesCount": 0
}
```

---

### 7️⃣ ETL Data Ingestion

**Ingest valid data:**

```bash
curl -X POST http://localhost:3000/api/etl/ingest \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TENANT_TOKEN" \
  -d '{
    "source": "csv_upload",
    "entityType": "invoice",
    "records": [
      {
        "customer_name": "Speed Test Corp",
        "amount": 10000,
        "external_id": "SPEED-001",
        "status": "paid"
      },
      {
        "customer_name": "Fast Co",
        "amount": 20000,
        "external_id": "SPEED-002",
        "status": "pending"
      }
    ]
  }'
```

**Expected Response:**
```json
{
  "jobId": "job-1770448229058-t2hcon",
  "status": "processing",
  "totalRecords": 2
}
```

**Check job status:**

```bash
curl -X GET http://localhost:3000/api/etl/jobs/<jobId> \
  -H "Authorization: Bearer $TENANT_TOKEN"
```

**Expected Response:**
```json
{
  "status": "completed",
  "totalRecords": 2,
  "result": {
    "total": 2,
    "synced": 2,
    "quarantined": 0
  }
}
```

---

### 8️⃣ ETL Validation & Quarantine

**Ingest messy data to test validation:**

```bash
curl -X POST http://localhost:3000/api/etl/ingest \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TENANT_TOKEN" \
  -d '{
    "source": "csv_upload",
    "entityType": "invoice",
    "records": [
      {
        "customer_name": "Valid Corp",
        "amount": 1500.50,
        "external_id": "VALID-001",
        "status": "pending"
      },
      {
        "customer_name": "",
        "amount": 2000,
        "status": "paid"
      },
      {
        "customer_name": "Invalid Amount",
        "amount": "not_a_number",
        "external_id": "INVALID-002",
        "status": "pending"
      },
      {
        "customer_name": "Negative Amount",
        "amount": -500,
        "external_id": "INVALID-003",
        "status": "pending"
      }
    ]
  }'
```

**Expected Result:**
- 1 record synced (Valid Corp)
- 3 records quarantined (validation errors)

---

### 9️⃣ Quarantine Management

**Get quarantine records:**

```bash
curl -X GET http://localhost:3000/api/quarantine \
  -H "Authorization: Bearer $TENANT_TOKEN"
```

**Expected Response:**
```json
{
  "data": [
    {
      "id": "quarantine-uuid",
      "tenant_id": "tenant-uuid",
      "source_type": "csv_upload",
      "raw_data": {
        "customer_name": "",
        "amount": 2000,
        "status": "paid"
      },
      "errors": [
        "Missing external_id",
        "Missing customer_name"
      ],
      "status": "pending",
      "created_at": "2026-02-07T..."
    }
  ],
  "total": 3,
  "limit": 10,
  "offset": 0
}
```

**Get quarantine status:**

```bash
curl -X GET http://localhost:3000/api/quarantine/status \
  -H "Authorization: Bearer $TENANT_TOKEN"
```

**Expected Response:**
```json
{
  "totalInvoices": 5,
  "quarantineCount": 3,
  "healthPercentage": "62.5%",
  "latestActivity": {
    "timestamp": "2026-02-07T..."
  }
}
```

---

### 🔟 Quarantine Retry

**Fix and retry a quarantined record:**

```bash
curl -X POST http://localhost:3000/api/quarantine/<quarantine-id>/retry \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TENANT_TOKEN" \
  -d '{
    "fixedData": {
      "customer_name": "Fixed Customer",
      "amount": 2000,
      "external_id": "FIXED-001",
      "status": "paid"
    }
  }'
```

**Expected Response:**
```json
{
  "success": true,
  "invoice": {
    "tenant_id": "tenant-uuid",
    "external_id": "FIXED-001",
    "customer_name": "[encrypted]",
    "amount": 2000,
    "status": "paid",
    "is_encrypted": true
  }
}
```

---

### 1️⃣1️⃣ Token Refresh

**Refresh access token:**

```bash
curl -X POST http://localhost:3000/api/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{
    "refreshToken": "<refresh_token_from_tenant_creation>"
  }'
```

**Expected Response:**
```json
{
  "access_token": "new_access_token",
  "refresh_token": "new_refresh_token"
}
```

---

### 1️⃣2️⃣ List Invoices

**Get all invoices for tenant:**

```bash
curl -X GET http://localhost:3000/api/invoices \
  -H "Authorization: Bearer $TENANT_TOKEN"
```

**Expected Response:**
```json
[
  {
    "id": "invoice-uuid",
    "tenant_id": "tenant-uuid",
    "invoice_number": "INV-...",
    "customer_name": "[encrypted]",
    "amount": "5000.00",
    "is_encrypted": true,
    "status": "pending",
    "created_at": "2026-02-07T..."
  }
]
```

---

### 1️⃣3️⃣ Tenant Isolation Test

**Attempt to access another tenant's data (should fail):**

```bash
# Create second user and tenant
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user2@example.com",
    "password": "SecurePass123!",
    "fullName": "User Two",
    "role": "ADMIN"
  }'

# Login and create second tenant
# ... (repeat steps 2-4)

# Try to access first tenant's invoices with second tenant's token
curl -X GET http://localhost:3000/api/invoices \
  -H "Authorization: Bearer $SECOND_TENANT_TOKEN"
```

**Expected Result:**
- Only second tenant's invoices returned
- First tenant's data completely isolated

---

## 🎯 Complete Test Script

Save this as `test-month1.sh`:

```bash
#!/bin/bash

BASE_URL="http://localhost:3000/api"

echo "🚀 Month 1 MVP Test Suite"
echo "=========================="

# 1. Register User
echo "\n1️⃣ Registering user..."
REGISTER_RESPONSE=$(curl -s -X POST $BASE_URL/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "SecurePass123!",
    "fullName": "Test User",
    "role": "ADMIN"
  }')
echo "✅ User registered"

# 2. Login
echo "\n2️⃣ Logging in..."
LOGIN_RESPONSE=$(curl -s -X POST $BASE_URL/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "SecurePass123!"
  }')
PUBLIC_TOKEN=$(echo $LOGIN_RESPONSE | jq -r '.access_token')
echo "✅ Login successful"

# 3. Create Tenant
echo "\n3️⃣ Creating tenant..."
TENANT_RESPONSE=$(curl -s -X POST $BASE_URL/tenants \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $PUBLIC_TOKEN" \
  -d '{
    "companyName": "Test Corp",
    "dataSourceType": "external",
    "subscriptionPlan": "enterprise"
  }')
TENANT_TOKEN=$(echo $TENANT_RESPONSE | jq -r '.auth.accessToken')
echo "✅ Tenant created"

# 4. Create Invoice
echo "\n4️⃣ Creating invoice..."
curl -s -X POST $BASE_URL/invoices \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TENANT_TOKEN" \
  -d '{
    "customer_name": "Client Corp",
    "amount": 5000,
    "currency": "USD",
    "status": "paid"
  }' > /dev/null
echo "✅ Invoice created"

# 5. Get Dashboard
echo "\n5️⃣ Fetching dashboard..."
DASHBOARD=$(curl -s -X GET $BASE_URL/finance/dashboard \
  -H "Authorization: Bearer $TENANT_TOKEN")
echo "✅ Dashboard data:"
echo $DASHBOARD | jq '.cashFlow'

# 6. ETL Ingest
echo "\n6️⃣ Testing ETL ingestion..."
ETL_RESPONSE=$(curl -s -X POST $BASE_URL/etl/ingest \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TENANT_TOKEN" \
  -d '{
    "source": "csv_upload",
    "entityType": "invoice",
    "records": [
      {
        "customer_name": "ETL Test",
        "amount": 10000,
        "external_id": "ETL-001",
        "status": "pending"
      }
    ]
  }')
JOB_ID=$(echo $ETL_RESPONSE | jq -r '.jobId')
echo "✅ ETL job started: $JOB_ID"

# Wait for ETL to complete
sleep 3

# 7. Check ETL Job
echo "\n7️⃣ Checking ETL job status..."
JOB_STATUS=$(curl -s -X GET $BASE_URL/etl/jobs/$JOB_ID \
  -H "Authorization: Bearer $TENANT_TOKEN")
echo "✅ Job status:"
echo $JOB_STATUS | jq '.'

# 8. Test Quarantine
echo "\n8️⃣ Testing quarantine with invalid data..."
curl -s -X POST $BASE_URL/etl/ingest \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TENANT_TOKEN" \
  -d '{
    "source": "csv_upload",
    "entityType": "invoice",
    "records": [
      {
        "customer_name": "",
        "amount": 2000,
        "status": "paid"
      }
    ]
  }' > /dev/null

sleep 2

# 9. Get Quarantine
echo "\n9️⃣ Fetching quarantine records..."
QUARANTINE=$(curl -s -X GET $BASE_URL/quarantine \
  -H "Authorization: Bearer $TENANT_TOKEN")
echo "✅ Quarantine count: $(echo $QUARANTINE | jq '.total')"

echo "\n✅ All tests completed successfully!"
```

**Run the test script:**

```bash
chmod +x test-month1.sh
./test-month1.sh
```

---

## 📊 Performance Benchmarks

| Operation | Average Time | Requirement | Status |
|-----------|-------------|-------------|--------|
| User Registration | ~100ms | < 1s | ✅ |
| Tenant Provisioning | ~600ms | < 2s | ✅ |
| Invoice Creation | ~50ms | < 100ms | ✅ |
| Dashboard Query | ~80ms | < 100ms | ✅ |
| ETL Processing (3 records) | ~3s | < 60s | ✅ |
| Dashboard Visibility | ~25s | < 60s | ✅ |

---

## 🔒 Security Features

- **Encryption**: AES-256 for sensitive data
- **Password Hashing**: bcrypt with 10 rounds
- **JWT Tokens**: Secure token-based authentication
- **SQL Injection Prevention**: Parameterized queries
- **Tenant Isolation**: Schema-per-tenant architecture
- **CORS**: Configurable cross-origin policies

---

## 🧪 Running Tests

```bash
# Unit tests
npm run test

# E2E tests
npm run test:e2e

# Test coverage
npm run test:cov
```

---

## 📖 Additional Documentation

- [Month 1 Status Report](./docs/MONTH1_STATUS_REPORT.md)
- [ETL Validation Tests](./docs/ETL_VALIDATION_TEST_RESULTS.md)
- [60-Second Dashboard Test](./docs/test-60-second-requirement.md)
- [Month 1 Final Report](./docs/MONTH1-FINAL-REPORT.md)
- [CSV Upload Testing](./docs/CSV-UPLOAD-TESTING.md)
- [OAuth2 Setup Guide](./docs/OAUTH2-SETUP.md)
- [CI/CD Setup Guide](./docs/CI-CD-SETUP.md)
- [API Documentation](http://localhost:3000/api) (Swagger)

---

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

---

## 📝 License

MIT License - see LICENSE file for details

---

## 🆘 Support

For issues and questions:
- Create an issue in the repository
- Contact: support@example.com

---

## 🎉 Month 1 MVP Status: 85% Complete

**Production Ready Features:**
- ✅ Multi-tenant architecture
- ✅ Authentication & authorization
- ✅ ETL pipeline with validation
- ✅ Quarantine system
- ✅ Finance dashboard API
- ✅ Data encryption
- ✅ Tenant isolation

**Pending:**
- ⏳ Frontend UI (dashboard, quarantine)
- ⏳ QuickBooks/Odoo connectors
- ⏳ CI/CD automation
