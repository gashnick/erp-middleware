// src/etl/interfaces/tenant-entities.interface.ts
//
// Tenant-schema entities have NO tenant_id column.
// Isolation is enforced entirely by PostgreSQL search_path, which
// TenantQueryRunnerService sets before every query. All tables below
// live inside the tenant schema and are never shared across tenants.

export interface BaseTenantEntity {
  id?: string;
  created_at?: Date;
}

export interface IContact extends BaseTenantEntity {
  name: string;
  external_id?: string;
  contact_info?: Record<string, any>;
  is_encrypted?: boolean;
  type: string;
}

export interface IInvoice extends BaseTenantEntity {
  invoice_number?: string;
  customer_name?: string;
  amount: number;
  is_encrypted: boolean;
  external_id?: string;
  currency: string;
  invoice_date?: Date;
  due_date?: Date;
  status: string;
  metadata?: Record<string, any>;
}

export interface IExpense extends BaseTenantEntity {
  category: string;
  vendor_id?: string;
  amount: number;
  currency: string;
  expense_date: Date;
  description?: string;
  metadata?: Record<string, any>;
}

export interface IBankTransaction extends BaseTenantEntity {
  type: 'credit' | 'debit';
  amount: number;
  currency: string;
  transaction_date: Date;
  description?: string;
  reference?: string;
  metadata?: Record<string, any>;
}

export interface IProduct extends BaseTenantEntity {
  name: string;
  external_id?: string;
  price: number;
  stock: number;
}

export interface IQuarantineRecord extends BaseTenantEntity {
  source_type: string;
  raw_data: any;
  errors: any;
  status: 'pending' | 'resolved' | 'ignored';
}

/** Generic result returned by every transformer method */
export interface TransformResult<T> {
  valid: T[];
  quarantine: Partial<IQuarantineRecord>[];
}
