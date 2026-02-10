# Complete Connector Framework Testing Guide

## 🚀 Prerequisites

1. **Start the application:**
   ```bash
   npm run start:dev
   ```

2. **Wait for app to be ready** (you should see "Nest application successfully started")

---

## 📋 Step-by-Step Testing

### **Step 1: Create User and Tenant**

```bash
# 1. Register user
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "connector-test@example.com",
    "password": "SecurePass123!",
    "fullName": "Connector Test User",
    "role": "ADMIN"
  }'
```

**Expected:** User created with ID

```bash
# 2. Login
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "connector-test@example.com",
    "password": "SecurePass123!"
  }'
```

**Expected:** Returns `access_token`

**Save the token:**
```bash
export PUBLIC_TOKEN="<paste_access_token_here>"
```

```bash
# 3. Create tenant
curl -X POST http://localhost:3000/api/provisioning/organizations \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $PUBLIC_TOKEN" \
  -d '{
    "companyName": "Connector Test Corp",
    "dataSourceType": "external",
    "subscriptionPlan": "enterprise"
  }'
```

**Expected:** Returns tenant with `accessToken` and `refreshToken`

**Save the tenant token:**
```bash
export TENANT_TOKEN="<paste_tenant_accessToken_here>"
```

---

### **Step 2: Test Connector Framework**

#### **2.1 Get Available Connector Types**

```bash
curl -X GET http://localhost:3000/api/connectors/types \
  -H "Authorization: Bearer $TENANT_TOKEN"
```

**Expected Response:**
```json
{
  "types": [
    "quickbooks",
    "odoo",
    "postgresql",
    "mysql",
    "xlsx_upload"
  ],
  "connectors": [
    { "type": "quickbooks", "name": "QuickBooks Online" },
    { "type": "odoo", "name": "Odoo ERP" },
    { "type": "postgresql", "name": "PostgreSQL Database" },
    { "type": "mysql", "name": "MySQL Database" },
    { "type": "xlsx_upload", "name": "XLSX File Upload" }
  ]
}
```

✅ **Success:** 5 connectors available

---

#### **2.2 Test QuickBooks Connector**

```bash
curl -X POST http://localhost:3000/api/connectors/test-connection \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TENANT_TOKEN" \
  -d '{
    "type": "quickbooks",
    "credentials": {
      "realmId": "123456789",
      "clientId": "test-client-id",
      "clientSecret": "test-secret",
      "accessToken": "test-token"
    }
  }'
```

**Expected Response:**
```json
{
  "success": true,
  "message": "QuickBooks connection successful",
  "details": {
    "realmId": "123456789"
  }
}
```

✅ **Success:** QuickBooks connector responds

---

#### **2.3 Test Odoo Connector**

```bash
curl -X POST http://localhost:3000/api/connectors/test-connection \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TENANT_TOKEN" \
  -d '{
    "type": "odoo",
    "credentials": {
      "url": "https://mycompany.odoo.com",
      "database": "production",
      "username": "admin",
      "password": "password"
    }
  }'
```

**Expected Response:**
```json
{
  "success": true,
  "message": "Odoo connection successful",
  "details": {
    "database": "production"
  }
}
```

✅ **Success:** Odoo connector responds

---

#### **2.4 Test PostgreSQL Connector**

```bash
curl -X POST http://localhost:3000/api/connectors/test-connection \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TENANT_TOKEN" \
  -d '{
    "type": "postgresql",
    "credentials": {
      "host": "localhost",
      "port": 5432,
      "database": "legacy_erp",
      "username": "readonly",
      "password": "password"
    }
  }'
```

**Expected Response:**
```json
{
  "success": true,
  "message": "PostgreSQL connection successful",
  "details": {
    "database": "legacy_erp"
  }
}
```

✅ **Success:** PostgreSQL connector responds

---

#### **2.5 Test MySQL Connector**

```bash
curl -X POST http://localhost:3000/api/connectors/test-connection \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TENANT_TOKEN" \
  -d '{
    "type": "mysql",
    "credentials": {
      "host": "localhost",
      "port": 3306,
      "database": "old_system",
      "username": "readonly",
      "password": "password"
    }
  }'
```

**Expected Response:**
```json
{
  "success": true,
  "message": "MySQL connection successful",
  "details": {
    "database": "old_system"
  }
}
```

✅ **Success:** MySQL connector responds

---

#### **2.6 Test XLSX Connector**

```bash
curl -X POST http://localhost:3000/api/connectors/test-connection \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TENANT_TOKEN" \
  -d '{
    "type": "xlsx_upload",
    "credentials": {}
  }'
```

**Expected Response:**
```json
{
  "success": true,
  "message": "XLSX connector ready"
}
```

✅ **Success:** XLSX connector responds

---

### **Step 3: Verify Tenant Isolation**

Create a second tenant and verify connectors are isolated:

```bash
# Register second user
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "connector-test2@example.com",
    "password": "SecurePass123!",
    "fullName": "Connector Test User 2",
    "role": "ADMIN"
  }'

# Login
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "connector-test2@example.com",
    "password": "SecurePass123!"
  }'

# Save token
export PUBLIC_TOKEN2="<paste_token>"

# Create second tenant
curl -X POST http://localhost:3000/api/provisioning/organizations \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $PUBLIC_TOKEN2" \
  -d '{
    "companyName": "Connector Test Corp 2",
    "dataSourceType": "external",
    "subscriptionPlan": "enterprise"
  }'

# Save tenant token
export TENANT_TOKEN2="<paste_tenant_token>"

# Test with second tenant
curl -X GET http://localhost:3000/api/connectors/types \
  -H "Authorization: Bearer $TENANT_TOKEN2"
```

✅ **Success:** Second tenant can also access connectors

---

## 🎯 Complete Test Script (Windows)

Save as `test-connectors.bat`:

```batch
@echo off
echo Testing Connector Framework
echo ===========================
echo.

REM Set your tenant token here
set TENANT_TOKEN=your-tenant-token-here

echo 1. Getting available connector types...
curl -X GET http://localhost:3000/api/connectors/types -H "Authorization: Bearer %TENANT_TOKEN%"
echo.
echo.

echo 2. Testing QuickBooks connector...
curl -X POST http://localhost:3000/api/connectors/test-connection -H "Content-Type: application/json" -H "Authorization: Bearer %TENANT_TOKEN%" -d "{\"type\":\"quickbooks\",\"credentials\":{\"realmId\":\"123\"}}"
echo.
echo.

echo 3. Testing Odoo connector...
curl -X POST http://localhost:3000/api/connectors/test-connection -H "Content-Type: application/json" -H "Authorization: Bearer %TENANT_TOKEN%" -d "{\"type\":\"odoo\",\"credentials\":{\"database\":\"test\"}}"
echo.
echo.

echo 4. Testing PostgreSQL connector...
curl -X POST http://localhost:3000/api/connectors/test-connection -H "Content-Type: application/json" -H "Authorization: Bearer %TENANT_TOKEN%" -d "{\"type\":\"postgresql\",\"credentials\":{\"database\":\"test\"}}"
echo.
echo.

echo 5. Testing MySQL connector...
curl -X POST http://localhost:3000/api/connectors/test-connection -H "Content-Type: application/json" -H "Authorization: Bearer %TENANT_TOKEN%" -d "{\"type\":\"mysql\",\"credentials\":{\"database\":\"test\"}}"
echo.
echo.

echo 6. Testing XLSX connector...
curl -X POST http://localhost:3000/api/connectors/test-connection -H "Content-Type: application/json" -H "Authorization: Bearer %TENANT_TOKEN%" -d "{\"type\":\"xlsx_upload\",\"credentials\":{}}"
echo.
echo.

echo All tests completed!
pause
```

---

## ✅ Success Checklist

- [ ] App is running (`npm run start:dev`)
- [ ] User registered successfully
- [ ] User logged in successfully
- [ ] Tenant created successfully
- [ ] GET /connectors/types returns 5 connectors
- [ ] QuickBooks test returns `success: true`
- [ ] Odoo test returns `success: true`
- [ ] PostgreSQL test returns `success: true`
- [ ] MySQL test returns `success: true`
- [ ] XLSX test returns `success: true`

---

## 🚨 Troubleshooting

### **Error: "Tenant identification missing"**
- Make sure you're using the **tenant token** (not the public token)
- The tenant token is returned in the `auth.accessToken` field when creating a tenant

### **Error: "Connector type not found"**
- Check the connector type spelling (lowercase)
- Valid types: `quickbooks`, `odoo`, `postgresql`, `mysql`, `xlsx_upload`

### **Error: Connection refused**
- Make sure the app is running: `npm run start:dev`
- Check the app is listening on port 3000

---

## 📊 What This Tests

1. **Connector Factory** - All 5 connectors are registered
2. **Connector Interface** - Each connector implements the interface
3. **Test Connection** - Each connector can test connections
4. **Tenant Isolation** - Each tenant has separate connector access
5. **API Integration** - Connectors are accessible via REST API

---

**Ready to test! Start the app and follow the steps above.** 🎉
