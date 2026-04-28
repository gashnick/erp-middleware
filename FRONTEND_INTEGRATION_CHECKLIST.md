# Frontend Integration Checklist

## ✅ What You Have (Backend Ready)

### ETL Pipeline
- **CSV Upload Endpoint**: `POST /connectors/csv-upload`
  - Accepts multipart form-data with file + entityType
  - Supports: `invoice`, `contact`, `expense`, `bank_transaction`, `product`, `employee`
  - Returns jobId for async tracking
  
- **Job Status Tracking**: `GET /connectors/jobs/:id`
  - Returns: `{ status, total, synced, quarantined, error }`
  
- **Quarantine Management**: `GET /connectors/quarantine`
  - Returns: `{ data: [], total, limit, offset }`
  
- **Quarantine Retry**: `POST /connectors/quarantine/:id/retry`
  - Accepts fixed data and reprocesses

### Invoice Management
- **Create Invoice**: `POST /invoices`
  - Fields: `customer_name`, `amount`, `currency`, `status`, `external_id`, `metadata`
  - Auto-encrypted at field level
  
- **List Invoices**: `GET /invoices`
  - Returns all tenant invoices (decrypted)
  
- **Get Invoice**: `GET /invoices/:id`
  - Single invoice retrieval
  
- **Update Invoice**: `PATCH /invoices/:id`
  - Update amount, status, metadata

### Finance Dashboard
- **Dashboard Metrics**: `GET /finance/dashboard`
  - Returns: cashFlow, arAging, apAging, profitability, anomalies

---

## 📋 Frontend Components Needed

### 1. **Invoice Upload Form**
```
┌─────────────────────────────────────┐
│ Invoice CSV Upload                  │
├─────────────────────────────────────┤
│ [Choose File] [Upload]              │
│ Supported: CSV with columns:        │
│ - customer_name (required)          │
│ - amount (required, numeric)        │
│ - currency (USD, EUR, etc)          │
│ - status (pending, paid, overdue)   │
│ - external_id (optional)            │
│ - invoice_date (optional)           │
│ - due_date (optional)               │
└─────────────────────────────────────┘
```

**Implementation:**
- Use `FormData` with file + entityType='invoice'
- POST to `/connectors/csv-upload`
- Store jobId for polling

### 2. **Upload Progress Tracker**
```
┌─────────────────────────────────────┐
│ Processing: invoices.csv            │
├─────────────────────────────────────┤
│ Status: Processing...               │
│ [████████░░░░░░░░░░] 50%            │
│                                     │
│ Poll /connectors/jobs/:jobId        │
│ every 1-2 seconds                   │
└─────────────────────────────────────┘
```

**Implementation:**
- Poll `GET /connectors/jobs/:jobId` every 1-2s
- Update UI with status, synced count, quarantined count
- Stop polling when status = 'completed' or 'failed'

### 3. **Invoice List View**
```
┌──────────────────────────────────────────────────────┐
│ Invoices                                             │
├──────────────────────────────────────────────────────┤
│ ID | Customer | Amount | Status | Created | Actions │
├──────────────────────────────────────────────────────┤
│ 1  | Acme Inc | $5000  | Paid   | Feb 7   | View    │
│ 2  | Beta LLC | $3500  | Pend   | Feb 7   | Edit    │
│ 3  | Gamma Co | $7500  | Pend   | Feb 7   | Delete  │
└──────────────────────────────────────────────────────┘
```

**Implementation:**
- GET `/invoices` on mount
- Display decrypted customer_name, amount, status
- Add Edit/Delete actions

### 4. **Quarantine Management Panel**
```
┌──────────────────────────────────────────────────────┐
│ Quarantine Records (3 issues)                        │
├──────────────────────────────────────────────────────┤
│ Record | Errors | Raw Data | Actions                │
├──────────────────────────────────────────────────────┤
│ Q-001  | Missing customer_name | {...} | Fix/Delete │
│ Q-002  | Invalid amount        | {...} | Fix/Delete │
│ Q-003  | Negative amount       | {...} | Fix/Delete │
└──────────────────────────────────────────────────────┘
```

**Implementation:**
- GET `/connectors/quarantine`
- Display errors array
- Show raw_data in modal/expandable
- Form to fix and POST `/connectors/quarantine/:id/retry`

### 5. **Finance Dashboard**
```
┌──────────────────────────────────────────────────────┐
│ Finance Dashboard                                    │
├──────────────────────────────────────────────────────┤
│ Cash Flow:                                           │
│  Total Invoiced: $16,000                            │
│  Total Collected: $3,500                            │
│  Outstanding: $12,500                               │
│                                                      │
│ AR Aging:                                            │
│  Current: $5,000 | 30+ days: $3,000                 │
│  60+ days: $2,000 | 90+ days: $2,500                │
└──────────────────────────────────────────────────────┘
```

**Implementation:**
- GET `/finance/dashboard`
- Display cashFlow, arAging, apAging metrics
- Render as cards/charts

---

## 🔧 API Integration Examples

### Upload Invoice CSV
```javascript
const formData = new FormData();
formData.append('file', csvFile);
formData.append('entityType', 'invoice');

const response = await fetch('/connectors/csv-upload', {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${token}` },
  body: formData
});

const { jobId } = await response.json();
// Poll /connectors/jobs/:jobId
```

### Poll Job Status
```javascript
const pollJob = async (jobId) => {
  const response = await fetch(`/connectors/jobs/${jobId}`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const job = await response.json();
  
  if (job.status === 'completed') {
    console.log(`Synced: ${job.synced}, Quarantined: ${job.quarantined}`);
  }
  
  if (job.status !== 'completed' && job.status !== 'failed') {
    setTimeout(() => pollJob(jobId), 1000);
  }
};
```

### Get Invoices
```javascript
const response = await fetch('/invoices', {
  headers: { 'Authorization': `Bearer ${token}` }
});
const { data } = await response.json();
// data is already decrypted
```

### Fix Quarantine Record
```javascript
const fixedData = {
  customer_name: 'Fixed Customer',
  amount: 2000,
  external_id: 'FIXED-001',
  status: 'paid'
};

const response = await fetch(`/connectors/quarantine/${quarantineId}/retry`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ fixedData })
});
```

---

## 📊 CSV Format Examples

### Valid Invoice CSV
```csv
customer_name,amount,currency,status,external_id,invoice_date,due_date
Acme Corp,5000.00,USD,pending,EXT-001,2026-02-07,2026-03-07
Beta Inc,3500.00,USD,paid,EXT-002,2026-02-01,2026-03-01
Gamma LLC,7500.00,USD,pending,EXT-003,2026-02-07,2026-03-07
```

### Valid Asset CSV (for ops dashboard)
```csv
external_id,name,category,status,uptime_pct,last_service,next_service
ASSET-001,Web Server 01,Infrastructure,operational,99.2,2026-01-10,2026-07-10
ASSET-002,Database Primary,Infrastructure,operational,99.9,2026-02-01,2026-08-01
```

### Valid Contact CSV
```csv
external_id,name,type,email,phone
CUST-001,John Doe,customer,john@example.com,555-1234
VEND-001,Acme Supplies,vendor,sales@acme.com,555-5678
```

### Valid Expense CSV
```csv
category,vendorName,amount,currency,expense_date,description
Office Supplies,Staples,250.00,USD,2026-02-07,Printer paper and ink
Travel,United Airlines,1200.00,USD,2026-02-06,Flight to NYC
```

---

## 🚀 Frontend Roadmap

### Phase 1: Basic Upload (Week 1)
- [ ] Invoice upload form
- [ ] Job status polling
- [ ] Success/error notifications

### Phase 2: Invoice Management (Week 2)
- [ ] Invoice list view
- [ ] Create/Edit/Delete invoices
- [ ] Search and filter

### Phase 3: Quarantine Handling (Week 3)
- [ ] Quarantine list view
- [ ] Fix form for invalid records
- [ ] Retry mechanism

### Phase 4: Dashboard (Week 4)
- [ ] Finance dashboard metrics
- [ ] Charts and visualizations
- [ ] Export functionality

---

## 🔐 Authentication

All endpoints require:
```
Authorization: Bearer <access_token>
```

Get token from:
1. `POST /auth/login` → returns `access_token`
2. `POST /tenants` → returns `auth.accessToken` (tenant-scoped)
3. `POST /auth/refresh` → refresh expired token

---

## ⚠️ Validation Rules (Backend Enforced)

### Invoice
- `customer_name`: Required, non-empty string
- `amount`: Required, positive number
- `currency`: Optional, defaults to USD
- `status`: Optional, defaults to 'draft'
- `external_id`: Optional, must be unique per tenant

### Contact
- `name`: Required, non-empty
- `type`: Required (customer, vendor, employee)
- `external_id`: Required, unique per tenant

### Expense
- `category`: Required
- `vendorName`: Optional (auto-creates vendor contact)
- `amount`: Required, positive
- `expense_date`: Required

### Asset
- `name`: Required
- `category`: Required
- `status`: Required (operational, maintenance, offline, retired)
- `uptime_pct`: Optional, 0-100

---

## 📞 Support

**Endpoints Summary:**
- Upload: `POST /connectors/csv-upload`
- Job Status: `GET /connectors/jobs/:id`
- Quarantine: `GET /connectors/quarantine`
- Retry: `POST /connectors/quarantine/:id/retry`
- Invoices: `GET/POST/PATCH /invoices`
- Dashboard: `GET /finance/dashboard`

**Test CSV Files Available:**
- `test-csv/invoices.csv`
- `test-csv/assets.csv`
- `test-csv/contacts.csv`
- `test-csv/expenses.csv`
- `test-csv/bank_transactions.csv`
- `test-csv/products.csv`
- `test-csv/employees.csv`
