# Connector Framework - curl Testing Guide

## 🧪 Test the Connector Framework with curl

### Prerequisites:
1. App running: `npm run start:dev`
2. Valid tenant token (from previous tests)

---

## 📋 Test Commands

### **1. Get Available Connector Types**

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

---

### **2. Test QuickBooks Connector**

```bash
curl -X POST http://localhost:3000/api/connectors/test-connection \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TENANT_TOKEN" \
  -d '{
    "type": "quickbooks",
    "credentials": {
      "realmId": "123456789",
      "clientId": "test-client-id",
      "clientSecret": "test-secret"
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

---

### **3. Test Odoo Connector**

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

---

### **4. Test PostgreSQL Connector**

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

---

### **5. Test MySQL Connector**

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

---

### **6. Test XLSX Connector**

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

---

## 🎯 Complete Test Script

Save as `test-connectors.sh`:

```bash
#!/bin/bash

BASE_URL="http://localhost:3000/api"

# Use your tenant token
TENANT_TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."

echo "🧪 Testing Connector Framework"
echo "================================\n"

# Test 1: Get available types
echo "1️⃣ Getting available connector types..."
curl -s -X GET $BASE_URL/connectors/types \
  -H "Authorization: Bearer $TENANT_TOKEN" | jq '.'
echo "\n"

# Test 2: Test QuickBooks
echo "2️⃣ Testing QuickBooks connector..."
curl -s -X POST $BASE_URL/connectors/test-connection \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TENANT_TOKEN" \
  -d '{
    "type": "quickbooks",
    "credentials": {"realmId": "123456"}
  }' | jq '.'
echo "\n"

# Test 3: Test Odoo
echo "3️⃣ Testing Odoo connector..."
curl -s -X POST $BASE_URL/connectors/test-connection \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TENANT_TOKEN" \
  -d '{
    "type": "odoo",
    "credentials": {"database": "test_db"}
  }' | jq '.'
echo "\n"

# Test 4: Test PostgreSQL
echo "4️⃣ Testing PostgreSQL connector..."
curl -s -X POST $BASE_URL/connectors/test-connection \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TENANT_TOKEN" \
  -d '{
    "type": "postgresql",
    "credentials": {"database": "legacy_db"}
  }' | jq '.'
echo "\n"

# Test 5: Test MySQL
echo "5️⃣ Testing MySQL connector..."
curl -s -X POST $BASE_URL/connectors/test-connection \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TENANT_TOKEN" \
  -d '{
    "type": "mysql",
    "credentials": {"database": "old_system"}
  }' | jq '.'
echo "\n"

# Test 6: Test XLSX
echo "6️⃣ Testing XLSX connector..."
curl -s -X POST $BASE_URL/connectors/test-connection \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TENANT_TOKEN" \
  -d '{
    "type": "xlsx_upload",
    "credentials": {}
  }' | jq '.'
echo "\n"

echo "✅ All connector tests completed!"
```

---

## 🚀 Quick Test (Windows)

```cmd
REM Get connector types
curl -X GET http://localhost:3000/api/connectors/types -H "Authorization: Bearer %TENANT_TOKEN%"

REM Test QuickBooks
curl -X POST http://localhost:3000/api/connectors/test-connection -H "Content-Type: application/json" -H "Authorization: Bearer %TENANT_TOKEN%" -d "{\"type\":\"quickbooks\",\"credentials\":{\"realmId\":\"123\"}}"

REM Test Odoo
curl -X POST http://localhost:3000/api/connectors/test-connection -H "Content-Type: application/json" -H "Authorization: Bearer %TENANT_TOKEN%" -d "{\"type\":\"odoo\",\"credentials\":{\"database\":\"test\"}}"
```

---

## ✅ Success Criteria

- ✅ GET /connectors/types returns 5 connector types
- ✅ Each connector test returns `success: true`
- ✅ QuickBooks connector responds
- ✅ Odoo connector responds
- ✅ PostgreSQL connector responds
- ✅ MySQL connector responds
- ✅ XLSX connector responds

---

**Ready to test!** Start the app and run these commands. 🎉
