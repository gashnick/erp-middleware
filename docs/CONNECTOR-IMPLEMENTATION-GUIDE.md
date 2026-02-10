# Connector Framework Implementation Guide

## 🏗️ Architecture Overview

The ERP middleware uses a **pluggable connector architecture** that makes it easy to add new data sources.

---

## 📊 Current Connectors

### ✅ **Implemented (Framework Ready):**
1. **CSV Upload** - Manual file upload
2. **QuickBooks Online** - OAuth2 integration (stub)
3. **Odoo ERP** - XML-RPC integration (stub)
4. **PostgreSQL** - Direct database connection (stub)
5. **MySQL** - Direct database connection (stub)
6. **XLSX Upload** - Excel file upload (stub)

### 🔌 **How to Add New Connectors:**

---

## 🎯 Connector Interface

All connectors implement the `IConnector` interface:

```typescript
export interface IConnector {
  readonly type: ConnectorType;
  readonly name: string;
  
  testConnection(config: ConnectorConfig): Promise<ConnectionTestResult>;
  fetchData(config: ConnectorConfig, options?: FetchOptions): Promise<ConnectorData[]>;
  sync(tenantId: string, config: ConnectorConfig): Promise<SyncResult>;
}
```

---

## 📝 Step-by-Step: Adding a New Connector

### **Step 1: Add Connector Type**

Edit `src/connectors/interfaces/connector.interface.ts`:

```typescript
export enum ConnectorType {
  CSV_UPLOAD = 'csv_upload',
  XLSX_UPLOAD = 'xlsx_upload',
  QUICKBOOKS = 'quickbooks',
  ODOO = 'odoo',
  POSTGRESQL = 'postgresql',
  MYSQL = 'mysql',
  SALESFORCE = 'salesforce', // ← Add new type
}
```

### **Step 2: Create Connector Implementation**

Create `src/connectors/implementations/salesforce.connector.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { BaseConnector } from '../base/base-connector';
import {
  ConnectorType,
  ConnectorConfig,
  ConnectionTestResult,
  FetchOptions,
  ConnectorData,
} from '../interfaces/connector.interface';
import { EtlService } from '../../etl/services/etl.service';

@Injectable()
export class SalesforceConnector extends BaseConnector {
  constructor(etlService: EtlService) {
    super(ConnectorType.SALESFORCE, 'Salesforce CRM', etlService);
  }

  async testConnection(config: ConnectorConfig): Promise<ConnectionTestResult> {
    try {
      const { instanceUrl, accessToken } = config.credentials;
      
      // Test Salesforce connection
      // const response = await fetch(`${instanceUrl}/services/data/v57.0/`, {
      //   headers: { Authorization: `Bearer ${accessToken}` }
      // });
      
      return {
        success: true,
        message: 'Salesforce connection successful',
      };
    } catch (error) {
      return {
        success: false,
        message: `Salesforce connection failed: ${error.message}`,
      };
    }
  }

  async fetchData(config: ConnectorConfig, options?: FetchOptions): Promise<ConnectorData[]> {
    const { instanceUrl, accessToken } = config.credentials;
    
    // Query Salesforce invoices
    // const query = `SELECT Id, Name, Amount__c, Status__c FROM Invoice__c`;
    // const response = await fetch(`${instanceUrl}/services/data/v57.0/query?q=${query}`, {
    //   headers: { Authorization: `Bearer ${accessToken}` }
    // });
    
    return [
      {
        externalId: 'SF-001',
        data: {
          customer_name: 'Salesforce Customer',
          amount: 5000,
          external_id: 'SF-001',
          status: 'pending',
        },
      },
    ];
  }
}
```

### **Step 3: Register in Factory**

Edit `src/connectors/services/connector-factory.service.ts`:

```typescript
import { SalesforceConnector } from '../implementations/salesforce.connector';

private registerConnectors() {
  this.register(new QuickBooksConnector(this.etlService));
  this.register(new OdooConnector(this.etlService));
  this.register(new PostgreSQLConnector(this.etlService));
  this.register(new MySQLConnector(this.etlService));
  this.register(new XLSXConnector(this.etlService));
  this.register(new SalesforceConnector(this.etlService)); // ← Add here
}
```

### **Step 4: Use the Connector**

```typescript
// In your controller or service
const connector = this.connectorFactory.get(ConnectorType.SALESFORCE);

// Test connection
const testResult = await connector.testConnection(config);

// Sync data
const syncResult = await connector.sync(tenantId, config);
```

---

## 🔧 Connector Configuration

Store connector credentials in the database:

```typescript
const config: ConnectorConfig = {
  id: 'uuid',
  tenantId: 'tenant-uuid',
  type: ConnectorType.SALESFORCE,
  credentials: {
    instanceUrl: 'https://mycompany.salesforce.com',
    accessToken: 'encrypted-token',
    refreshToken: 'encrypted-refresh-token',
  },
  settings: {
    syncFrequency: 'hourly',
    objectTypes: ['Invoice__c', 'Payment__c'],
  },
  isActive: true,
};
```

---

## 📊 Data Flow

```
External System (Salesforce, QuickBooks, etc.)
    ↓
Connector.fetchData() → Fetch raw data
    ↓
Transform to standard format
    ↓
Connector.sync() → Pass to ETL Service
    ↓
ETL Service validates each record
    ↓
Valid → invoices table
Invalid → data_quarantine table
```

---

## 🎯 Real-World Examples

### **Example 1: QuickBooks Integration**

```typescript
// 1. User configures QuickBooks connector
POST /api/connectors
{
  "type": "quickbooks",
  "name": "My QuickBooks",
  "credentials": {
    "clientId": "...",
    "clientSecret": "...",
    "realmId": "...",
    "accessToken": "..."
  }
}

// 2. Test connection
POST /api/connectors/{id}/test

// 3. Trigger sync
POST /api/connectors/{id}/sync

// 4. Data flows:
QuickBooks API → Connector → ETL → Invoices/Quarantine
```

### **Example 2: PostgreSQL Integration**

```typescript
// 1. Configure PostgreSQL connector
POST /api/connectors
{
  "type": "postgresql",
  "name": "Legacy Database",
  "credentials": {
    "host": "db.company.com",
    "port": 5432,
    "database": "legacy_erp",
    "username": "readonly",
    "password": "encrypted"
  },
  "settings": {
    "query": "SELECT * FROM invoices WHERE updated_at > $1",
    "syncFrequency": "daily"
  }
}

// 2. Sync runs automatically or manually
PostgreSQL → Connector → ETL → Invoices/Quarantine
```

---

## 🔒 Security Best Practices

### **1. Encrypt Credentials**

```typescript
import { EncryptionService } from '@common/security/encryption.service';

// Before saving
config.credentials = await encryptionService.encrypt(
  JSON.stringify(credentials),
  tenantKey
);

// Before using
const decrypted = await encryptionService.decrypt(
  config.credentials,
  tenantKey
);
```

### **2. Use OAuth2 When Possible**

```typescript
// QuickBooks, Salesforce, etc.
const oauth2Client = new OAuth2Client({
  clientId: config.credentials.clientId,
  clientSecret: config.credentials.clientSecret,
  redirectUri: 'https://your-app.com/callback',
});
```

### **3. Validate Permissions**

```typescript
@Post('connectors')
@Roles(Role.ADMIN) // Only admins can create connectors
async createConnector(@Body() dto: CreateConnectorDto) {
  // ...
}
```

---

## 📦 Required Dependencies

### **QuickBooks:**
```bash
npm install node-quickbooks
```

### **Odoo:**
```bash
npm install odoo-xmlrpc
```

### **PostgreSQL:**
```bash
npm install pg
```

### **MySQL:**
```bash
npm install mysql2
```

### **XLSX:**
```bash
npm install xlsx
```

### **Salesforce:**
```bash
npm install jsforce
```

---

## 🧪 Testing Connectors

```typescript
describe('SalesforceConnector', () => {
  it('should test connection successfully', async () => {
    const result = await connector.testConnection(mockConfig);
    expect(result.success).toBe(true);
  });

  it('should fetch data from Salesforce', async () => {
    const data = await connector.fetchData(mockConfig);
    expect(data.length).toBeGreaterThan(0);
  });

  it('should sync data to ERP', async () => {
    const result = await connector.sync(tenantId, mockConfig);
    expect(result.synced).toBeGreaterThan(0);
  });
});
```

---

## 🚀 Future Connectors

### **Planned:**
- Xero Accounting
- Sage Intacct
- NetSuite
- SAP Business One
- Microsoft Dynamics
- Stripe
- PayPal
- Shopify
- WooCommerce
- REST API (generic)
- GraphQL API (generic)

### **How Users Can Add Custom Connectors:**

1. **Via UI (Future):**
   - Select "Custom API" connector type
   - Configure endpoint, authentication, field mapping
   - System generates connector automatically

2. **Via Code:**
   - Follow this guide
   - Create custom connector class
   - Register in factory
   - Deploy

---

## 📊 Connector Status Dashboard

```typescript
GET /api/connectors/status

Response:
{
  "connectors": [
    {
      "id": "uuid",
      "type": "quickbooks",
      "name": "My QuickBooks",
      "status": "active",
      "lastSync": "2026-02-10T10:00:00Z",
      "nextSync": "2026-02-10T11:00:00Z",
      "totalSynced": 1500,
      "totalQuarantined": 25
    }
  ]
}
```

---

## ✅ Implementation Checklist

- [x] Base connector interface
- [x] Base connector abstract class
- [x] Connector factory
- [x] QuickBooks connector (stub)
- [x] Odoo connector (stub)
- [x] PostgreSQL connector (stub)
- [x] MySQL connector (stub)
- [x] XLSX connector (stub)
- [ ] Implement QuickBooks OAuth2
- [ ] Implement Odoo XML-RPC
- [ ] Implement PostgreSQL queries
- [ ] Implement MySQL queries
- [ ] Implement XLSX parsing
- [ ] Add connector CRUD endpoints
- [ ] Add connector test endpoint
- [ ] Add connector sync scheduling
- [ ] Add connector status monitoring
- [ ] Add connector error handling
- [ ] Add connector retry logic
- [ ] Add connector rate limiting
- [ ] Add connector webhook support

---

**The framework is ready! Just implement the TODO sections in each connector.** 🎉
