// src/etl/services/etl-transformer.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { EncryptionService } from '@common/security/encryption.service';
import {
  IInvoice,
  IContact,
  IExpense,
  IBankTransaction,
  IProduct,
  IEmployee,
  IQuarantineRecord,
  TransformResult,
  EmployeeStatus,
} from '../interfaces/tenant-entities.interface';

// 🚀 Match the type from EtlService
type EntityType = 'invoice' | 'contact' | 'expense' | 'bank_transaction' | 'product' | 'employee';

@Injectable()
export class EtlTransformerService {
  private readonly logger = new Logger(EtlTransformerService.name);
  private readonly MIN_AMOUNT = 0.01;
  private readonly MAX_AMOUNT = 999_999_999.99;

  private readonly VALID_CONTACT_TYPES = new Set([
    'vendor',
    'customer',
    'supplier',
    'partner',
    'other',
  ]);

  private readonly STATUS_MAP: Record<string, string> = {
    pending: 'sent',
    open: 'sent',
    unpaid: 'sent',
    issued: 'sent',
    approved: 'sent',
    authorised: 'sent',
    authorized: 'sent',
    complete: 'paid',
    completed: 'paid',
    closed: 'paid',
    settled: 'paid',
    cleared: 'paid',
    late: 'overdue',
    past_due: 'overdue',
    pastdue: 'overdue',
    delinquent: 'overdue',
    cancelled: 'void',
    canceled: 'void',
    voided: 'void',
    written_off: 'void',
    writtenoff: 'void',
    deleted: 'void',
    draft: 'draft',
    sent: 'sent',
    paid: 'paid',
    overdue: 'overdue',
    void: 'void',
  };

  /**
   * Canonical employee status values accepted by the employees table CHECK constraint.
   * Any raw value not in this set falls back to 'active'.
   */
  private readonly VALID_EMPLOYEE_STATUSES = new Set<EmployeeStatus>([
    'active',
    'inactive',
    'on_leave',
    'terminated',
  ]);

  /**
   * Field aliases accepted for each employee column.
   * Priority: first truthy value in each array wins.
   */
  private readonly EMPLOYEE_FIELD_ALIASES = {
    external_id: ['external_id', 'employee_id', 'employeeId', 'emp_id', 'id'],
    name: ['name', 'full_name', 'fullName', 'employee_name', 'employeeName'],
    department: ['department', 'dept', 'division', 'team'],
    role: ['role', 'job_title', 'jobTitle', 'title', 'position'],
    status: ['status', 'employment_status', 'employmentStatus', 'emp_status'],
    start_date: ['start_date', 'startDate', 'hire_date', 'hireDate', 'joined_at', 'joinedAt'],
    end_date: ['end_date', 'endDate', 'termination_date', 'terminationDate', 'left_at', 'leftAt'],
    salary: [
      'salary',
      'base_salary',
      'baseSalary',
      'annual_salary',
      'annualSalary',
      'compensation',
    ],
    currency: ['currency', 'salary_currency', 'salaryCurrency', 'pay_currency'],
  } as const;

  private readonly CATEGORY_VENDOR_MAP: Record<string, string> = {
    PAYROLL: 'Payroll Services',
    INFRASTRUCTURE: 'Infrastructure Provider',
    MARKETING: 'Marketing Services',
    OFFICE: 'Office Expenses',
    TRAVEL: 'Travel Expenses',
    LEGAL: 'Legal Services',
    SOFTWARE: 'Software & Subscriptions',
  };

  constructor(private readonly encryptionService: EncryptionService) {}

  // ── Invoices ───────────────────────────────────────────────────────────────

  transformInvoices(rawData: any[], tenantId: string, source: string): TransformResult<IInvoice> {
    const valid: IInvoice[] = [];
    const quarantine: Partial<IQuarantineRecord>[] = [];

    rawData.forEach((row, i) => {
      const normalized = {
        external_id: row.external_id ?? row.invoice_id ?? row.invoiceId,
        amount: row.amount ?? row.total_amount ?? row.totalAmount,
        customer_name: row.customer_name ?? row.customerName,
        invoice_number: row.invoice_number ?? undefined,
        currency: (row.currency ?? 'USD').toUpperCase(),
        status: row.status ?? 'draft',
        invoice_date: row.invoice_date ?? row.invoiceDate ?? row.date,
        due_date: row.due_date ?? row.dueDate,
      };

      const errors = this.validateInvoice(normalized, i + 1);
      if (errors.length > 0) {
        quarantine.push(this.makeQuarantine(source, row, errors, 'invoice'));
        return;
      }

      try {
        valid.push({
          external_id: String(normalized.external_id).trim(),
          customer_name: this.encryptionService.encrypt(String(normalized.customer_name)),
          invoice_number: this.encryptionService.encrypt(
            normalized.invoice_number || `AUTO-${Date.now()}-${i}`,
          ),
          amount: parseFloat(normalized.amount),
          status: this.normalizeStatus(normalized.status),
          currency: normalized.currency,
          invoice_date: normalized.invoice_date ? new Date(normalized.invoice_date) : undefined,
          due_date: normalized.due_date ? new Date(normalized.due_date) : undefined,
          is_encrypted: true,
          metadata: { source, sync_date: new Date().toISOString() },
        });
      } catch (e) {
        quarantine.push(
          this.makeQuarantine(source, row, [`Encryption failed: ${e.message}`], 'invoice'),
        );
      }
    });

    return { valid, quarantine };
  }

  // ── Contacts ───────────────────────────────────────────────────────────────

  transformContacts(rawData: any[], source: string): TransformResult<IContact> {
    const valid: IContact[] = [];
    const quarantine: Partial<IQuarantineRecord>[] = [];

    rawData.forEach((row, i) => {
      const normalized = {
        external_id: row.external_id ?? row.id ?? row.contactId,
        name: row.name ?? row.company_name ?? row.companyName,
        type: (row.type ?? 'other').toLowerCase().trim(),
        contact_info: row.contact_info
          ? typeof row.contact_info === 'string'
            ? this.parseJson(row.contact_info)
            : row.contact_info
          : undefined,
      };

      const errors: string[] = [];
      if (!normalized.external_id) errors.push(`Row ${i + 1}: Missing external_id`);
      if (!normalized.name) errors.push(`Row ${i + 1}: Missing name`);

      if (errors.length > 0) {
        quarantine.push(this.makeQuarantine(source, row, errors, 'contact'));
        return;
      }

      valid.push({
        external_id: String(normalized.external_id).trim(),
        name: String(normalized.name).trim(),
        type: this.VALID_CONTACT_TYPES.has(normalized.type) ? normalized.type : 'other',
        contact_info: normalized.contact_info,
      });
    });

    return { valid, quarantine };
  }

  // ── Expenses ───────────────────────────────────────────────────────────────

  transformExpenses(rawData: any[], source: string): TransformResult<IExpense> {
    const valid: IExpense[] = [];
    const quarantine: Partial<IQuarantineRecord>[] = [];

    rawData.forEach((row, i) => {
      const category = (row.category ?? row.expense_category ?? 'OTHER')
        .toString()
        .toUpperCase()
        .trim();

      const normalized = {
        category,
        amount: row.amount ?? row.total,
        currency: (row.currency ?? 'USD').toUpperCase(),
        expense_date: row.expense_date ?? row.date ?? row.expenseDate,
        description: row.description ?? row.notes,
        vendorName: this.resolveVendorName(row, category),
      };

      const errors: string[] = [];
      if (!normalized.expense_date) errors.push(`Row ${i + 1}: Missing expense_date`);
      const amt = parseFloat(normalized.amount);
      if (isNaN(amt) || amt < this.MIN_AMOUNT) errors.push(`Row ${i + 1}: Invalid amount`);

      if (errors.length > 0) {
        quarantine.push(this.makeQuarantine(source, row, errors, 'expense'));
        return;
      }

      valid.push({
        category: normalized.category,
        amount: amt,
        currency: normalized.currency,
        expense_date: new Date(normalized.expense_date),
        description: normalized.description ? String(normalized.description).trim() : undefined,
        vendorName: normalized.vendorName,
        metadata: { source, sync_date: new Date().toISOString() },
      });
    });

    return { valid, quarantine };
  }

  // ── Bank Transactions ──────────────────────────────────────────────────────

  transformBankTransactions(rawData: any[], source: string): TransformResult<IBankTransaction> {
    const valid: IBankTransaction[] = [];
    const quarantine: Partial<IQuarantineRecord>[] = [];

    rawData.forEach((row, i) => {
      const normalized = {
        type: (row.type ?? '').toLowerCase().trim() as 'credit' | 'debit',
        amount: row.amount,
        currency: (row.currency ?? 'USD').toUpperCase(),
        transaction_date: row.transaction_date ?? row.date ?? row.txDate,
        description: row.description ?? row.notes,
        reference: row.reference ?? row.ref,
      };

      const errors: string[] = [];
      if (!['credit', 'debit'].includes(normalized.type)) {
        errors.push(`Row ${i + 1}: type must be 'credit' or 'debit'`);
      }
      if (!normalized.transaction_date) errors.push(`Row ${i + 1}: Missing transaction_date`);

      const amt = parseFloat(normalized.amount);
      if (isNaN(amt) || amt <= 0) errors.push(`Row ${i + 1}: Invalid amount`);

      if (errors.length > 0) {
        quarantine.push(this.makeQuarantine(source, row, errors, 'bank_transaction'));
        return;
      }

      valid.push({
        type: normalized.type,
        amount: amt,
        currency: normalized.currency,
        transaction_date: new Date(normalized.transaction_date),
        description: normalized.description ? String(normalized.description).trim() : undefined,
        reference: normalized.reference ? String(normalized.reference).trim() : undefined,
        metadata: { source, sync_date: new Date().toISOString() },
      });
    });

    return { valid, quarantine };
  }

  // ── Products ───────────────────────────────────────────────────────────────

  transformProducts(rawData: any[], source: string): TransformResult<IProduct> {
    const valid: IProduct[] = [];
    const quarantine: Partial<IQuarantineRecord>[] = [];

    rawData.forEach((row, i) => {
      const normalized = {
        external_id: row.external_id ?? row.sku ?? row.productId,
        name: row.name ?? row.product_name ?? row.productName,
        price: row.price ?? row.unit_price,
        stock: row.stock ?? row.quantity ?? row.inventory ?? 0,
      };

      const errors: string[] = [];
      if (!normalized.external_id) errors.push(`Row ${i + 1}: Missing external_id`);

      if (errors.length > 0) {
        quarantine.push(this.makeQuarantine(source, row, errors, 'product'));
        return;
      }

      valid.push({
        external_id: String(normalized.external_id).trim(),
        name: String(normalized.name).trim(),
        price: parseFloat(normalized.price) || 0,
        stock: parseInt(String(normalized.stock), 10) || 0,
      });
    });

    return { valid, quarantine };
  }

  // ── Employees ──────────────────────────────────────────────────────────────

  /**
   * Transforms raw CSV rows into validated IEmployee objects.
   *
   * Field resolution uses EMPLOYEE_FIELD_ALIASES — the first truthy value
   * found across the alias list is used, so CSVs exported from different
   * HR systems (BambooHR, Workday, Odoo, manual) all parse correctly without
   * any pre-processing by the caller.
   *
   * Validation rules:
   *   - external_id: required (unique key for ON CONFLICT upsert)
   *   - name:        required
   *   - department:  required
   *   - role:        required
   *   - start_date:  required, must parse to a valid Date
   *   - salary:      required, must be a non-negative finite number
   *
   * Soft-defaults (never quarantine):
   *   - status   → 'active' if missing or unrecognised
   *   - currency → 'USD' if missing
   *   - end_date → null if missing (still employed)
   */
  transformEmployees(rawData: any[], source: string): TransformResult<IEmployee> {
    const valid: IEmployee[] = [];
    const quarantine: Partial<IQuarantineRecord>[] = [];

    rawData.forEach((row, i) => {
      const rowNum = i + 1;

      // ── Field resolution via alias table ─────────────────────────────────
      const resolve = (field: keyof typeof this.EMPLOYEE_FIELD_ALIASES): any => {
        for (const alias of this.EMPLOYEE_FIELD_ALIASES[field]) {
          const val = row[alias];
          if (val !== undefined && val !== null && String(val).trim() !== '') return val;
        }
        return undefined;
      };

      const raw = {
        external_id: resolve('external_id'),
        name: resolve('name'),
        department: resolve('department'),
        role: resolve('role'),
        status: resolve('status'),
        start_date: resolve('start_date'),
        end_date: resolve('end_date'),
        salary: resolve('salary'),
        currency: resolve('currency'),
      };

      // ── Validation ────────────────────────────────────────────────────────
      const errors: string[] = [];

      if (!raw.external_id) errors.push(`Row ${rowNum}: Missing external_id / employee_id`);
      if (!raw.name) errors.push(`Row ${rowNum}: Missing name`);
      if (!raw.department) errors.push(`Row ${rowNum}: Missing department`);
      if (!raw.role) errors.push(`Row ${rowNum}: Missing role`);

      if (!raw.start_date) {
        errors.push(`Row ${rowNum}: Missing start_date`);
      } else if (isNaN(new Date(raw.start_date).getTime())) {
        errors.push(`Row ${rowNum}: Invalid start_date '${raw.start_date}'`);
      }

      const salaryNum = parseFloat(raw.salary);
      if (raw.salary === undefined || raw.salary === null || raw.salary === '') {
        errors.push(`Row ${rowNum}: Missing salary`);
      } else if (isNaN(salaryNum) || salaryNum < 0) {
        errors.push(
          `Row ${rowNum}: Invalid salary '${raw.salary}' — must be a non-negative number`,
        );
      }

      if (errors.length > 0) {
        quarantine.push(this.makeQuarantine(source, row, errors, 'employee'));
        return;
      }

      // ── Normalisation ─────────────────────────────────────────────────────

      // status — soft-default to 'active' for unrecognised values
      const rawStatus = String(raw.status ?? '')
        .toLowerCase()
        .trim()
        .replace(/[\s-]+/g, '_') as EmployeeStatus;
      const status: EmployeeStatus = this.VALID_EMPLOYEE_STATUSES.has(rawStatus)
        ? rawStatus
        : 'active';

      // end_date — null when employee is still active or field absent
      let end_date: Date | null = null;
      if (raw.end_date) {
        const parsed = new Date(raw.end_date);
        end_date = isNaN(parsed.getTime()) ? null : parsed;
      }

      valid.push({
        external_id: String(raw.external_id).trim(),
        name: String(raw.name).trim(),
        department: String(raw.department).trim(),
        role: String(raw.role).trim(),
        status,
        start_date: new Date(raw.start_date),
        end_date,
        salary: salaryNum,
        currency: raw.currency ? String(raw.currency).toUpperCase().trim() : 'USD',
        metadata: { source, sync_date: new Date().toISOString() },
      });
    });

    return { valid, quarantine };
  }

  // ── Shared helpers ─────────────────────────────────────────────────────────

  private normalizeStatus(raw: string): string {
    if (!raw) return 'draft';
    const key = raw.toLowerCase().trim().replace(/\s+/g, '_');
    return this.STATUS_MAP[key] ?? 'draft';
  }

  private validateInvoice(row: any, index: number): string[] {
    const errors: string[] = [];
    if (!row?.external_id) errors.push(`Row ${index}: Missing external_id`);
    if (!row?.customer_name) errors.push(`Row ${index}: Missing customer_name`);
    const amt = parseFloat(row?.amount);
    if (isNaN(amt) || amt < this.MIN_AMOUNT || amt > this.MAX_AMOUNT) {
      errors.push(`Row ${index}: Invalid amount`);
    }
    return errors;
  }

  private makeQuarantine(
    source: string,
    raw_data: any,
    errors: string[],
    entityType: EntityType,
  ): Partial<IQuarantineRecord> {
    return {
      source_type: source,
      raw_data,
      errors,
      status: 'pending' as const,
      entity_type: entityType,
    };
  }

  private parseJson(value: string): Record<string, any> | undefined {
    try {
      return JSON.parse(value);
    } catch {
      return undefined;
    }
  }

  /**
   * Resolves vendor name — three-tier priority, no DB access:
   *   1. Explicit vendor field in the CSV row
   *   2. CATEGORY_VENDOR_MAP canonical name
   *   3. Category name itself as fallback
   */
  private resolveVendorName(row: any, category: string): string {
    const explicit = row.vendor ?? row.vendor_name ?? row.vendorName ?? row.supplier;
    if (explicit && String(explicit).trim()) return String(explicit).trim();
    return this.CATEGORY_VENDOR_MAP[category] ?? category;
  }
}
