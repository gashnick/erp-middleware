export interface ValidInvoice {
  customer_name: string; // Will be encrypted text in DB
  invoice_number: string; // Will be encrypted text in DB
  amount: number; // Plain decimal for math
  status: string; // 'draft', 'paid', etc.
  is_encrypted: boolean; // Flag for the decryption layer
  metadata?: string; // AI/Lineage data (JSON string)
  external_id?: string; // For ERP sync (QuickBooks/Odoo)
}
