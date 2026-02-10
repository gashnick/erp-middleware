# CSV Upload Testing Guide (Swagger)

## 📋 Prerequisites

1. Application running: `npm run start:dev`
2. Swagger UI: http://localhost:3000/api
3. Valid tenant token (from tenant creation)

---

## 🚀 Step-by-Step Testing

### 1. Get Your Tenant Token

If you don't have one, create a tenant first:

```bash
# Register user
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "csvtest@example.com",
    "password": "SecurePass123!",
    "fullName": "CSV Test User",
    "role": "ADMIN"
  }'

# Login
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "csvtest@example.com",
    "password": "SecurePass123!"
  }'

# Save the access_token
export PUBLIC_TOKEN="<access_token>"

# Create tenant
curl -X POST http://localhost:3000/api/provisioning/organizations \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $PUBLIC_TOKEN" \
  -d '{
    "companyName": "CSV Test Corp",
    "dataSourceType": "external",
    "subscriptionPlan": "enterprise"
  }'

# Save the tenant accessToken
export TENANT_TOKEN="<accessToken_from_response>"
```

---

### 2. Open Swagger UI

Navigate to: **http://localhost:3000/api**

---

### 3. Authorize in Swagger

1. Click the **"Authorize"** button (top right, lock icon)
2. Enter your tenant token: `Bearer <TENANT_TOKEN>`
3. Click **"Authorize"**
4. Click **"Close"**

---

### 4. Test CSV Upload

#### Find the Endpoint:
- Expand **"Connectors"** section
- Find **POST /api/connectors/csv-upload**
- Click **"Try it out"**

#### Upload File:
1. Click **"Choose File"** button
2. Select `sample-invoices.csv` from project root
3. Click **"Execute"**

#### Expected Response (200):
```json
{
  "jobId": "job-1770495519918-v26tq9",
  "status": "processing",
  "totalRecords": 4
}
```

---

### 5. Check Job Status

Use the ETL endpoints to check processing status:

#### In Swagger:
- Expand **"ETL"** section
- Find **GET /api/etl/jobs/{jobId}**
- Click **"Try it out"**
- Enter the `jobId` from previous response
- Click **"Execute"**

#### Expected Response:
```json
{
  "status": "completed",
  "totalRecords": 4,
  "result": {
    "total": 4,
    "synced": 4,
    "quarantined": 0
  }
}
```

---

### 6. Verify Invoices Created

#### In Swagger:
- Expand **"Invoices"** section
- Find **GET /api/invoices**
- Click **"Try it out"**
- Click **"Execute"**

You should see 4 new invoices from the CSV file.

---

## 📄 Sample CSV Format

The `sample-invoices.csv` file contains:

```csv
customer_name,amount,external_id,status,currency
Acme Corporation,5000.00,INV-001,pending,USD
Beta Industries,3500.50,INV-002,paid,USD
Gamma LLC,7200.00,INV-003,pending,USD
Delta Corp,1500.00,INV-004,paid,USD
```

### Required Columns:
- `customer_name` - Customer name (required)
- `amount` - Invoice amount (required, positive number)
- `external_id` - External reference ID (required)
- `status` - Invoice status (pending, paid, overdue, draft)
- `currency` - Currency code (optional, defaults to USD)

---

## 🧪 Test Invalid Data

Create a file `invalid-invoices.csv`:

```csv
customer_name,amount,external_id,status,currency
,5000.00,INV-001,pending,USD
Valid Corp,not_a_number,INV-002,paid,USD
Another Corp,-500,INV-003,pending,USD
```

Upload this file and check:
- Records with missing customer_name → Quarantined
- Records with invalid amount → Quarantined
- Records with negative amount → Quarantined

Check quarantine:
- **GET /api/quarantine** in Swagger

---

## 🎯 File Limits

- **Max file size**: 10 MB
- **Max rows**: 10,000
- **Min rows**: 1
- **Format**: CSV with comma delimiter
- **Encoding**: UTF-8

---

## ❌ Common Errors

### "No file provided"
- Make sure you selected a file before clicking Execute

### "Tenant identification missing"
- Your token expired or is invalid
- Re-authorize with a fresh tenant token

### "File exceeds 10485760 bytes"
- Your CSV file is too large
- Split into smaller files

### "CSV missing header or data rows"
- CSV must have header row + at least 1 data row
- Check file format

---

## ✅ Success Checklist

- [ ] Swagger UI opens at http://localhost:3000/api
- [ ] Authorized with tenant token
- [ ] CSV file uploaded successfully
- [ ] Job ID returned
- [ ] Job status shows "completed"
- [ ] Invoices visible in GET /api/invoices
- [ ] Dashboard metrics updated

---

## 🔄 Testing Workflow

```
1. Authorize → 2. Upload CSV → 3. Get Job ID → 4. Check Status → 5. View Invoices
```

**Happy Testing!** 🎉
