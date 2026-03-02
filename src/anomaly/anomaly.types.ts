export type AnomalyType = 'EXPENSE_SPIKE' | 'DUPLICATE_INVOICE' | 'UNUSUAL_PAYMENT';

export interface AnomalyCandidate {
  tenantId: string;
  type: AnomalyType;
  score: number;
  confidence: number;
  explanation: string;
  relatedIds: string[];
  detectedAt: Date;
}

export interface PersistedAnomaly extends AnomalyCandidate {
  id: string;
}

export interface VendorSpend {
  vendorId: string;
  vendorName: string;
  month: number;
  year: number;
  spend: number;
}

export interface DuplicateCandidate {
  fingerprint: string;
  invoiceIds: string[];
}

export interface PaymentRecord {
  id: string;
  amount: number;
  hour: number;
  dayOfWeek: number;
}
