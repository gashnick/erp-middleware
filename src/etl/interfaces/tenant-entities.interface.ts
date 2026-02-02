export interface BaseTenantEntity {
  id?: string;
  tenant_id: string;
  created_at?: Date;
}

export interface IContact extends BaseTenantEntity {
  name: string;
  external_id?: string;
  contact_info?: Record<string, any>;
  is_encrypted: boolean;
  type: string;
}

export interface IInvoice extends BaseTenantEntity {
  invoice_number?: string;
  customer_name?: string;
  amount: number;
  is_encrypted: boolean;
  external_id?: string;
  currency: string;
  due_date?: Date;
  status: string;
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
  errors: any; // Stored as jsonb in DB
  status: 'pending' | 'resolved' | 'ignored';
}
