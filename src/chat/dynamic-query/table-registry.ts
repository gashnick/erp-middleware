// src/chat/dynamic-query/table-registry.ts
//
// Single source of truth for every table the AI engine is allowed to query.
// Nothing outside this file decides what tables or columns are accessible.
//
// Security guarantees:
//  • Only tables listed here can be queried — no migrations, quarantine, audit_logs, etc.
//  • Only columns listed in `allowedColumns` can appear in SELECT or WHERE clauses.
//  • Aggregation templates are predefined strings — never built from user input.
//  • Every parameter is bound via parameterized queries ($1, $2, …).

// ── Types ─────────────────────────────────────────────────────────────────────

export type QueryIntent =
  | 'cash_position'
  | 'revenue_trend'
  | 'expense_breakdown'
  | 'invoice_summary'
  | 'overdue_invoices'
  | 'bank_transactions'
  | 'product_inventory'
  | 'anomaly_summary'
  | 'contact_list';

export type AggregationMode = 'raw' | 'sum' | 'count' | 'avg' | 'group_sum';

export interface ColumnDef {
  name: string;
  // Optional alias exposed to the LLM — keeps internal names private
  alias?: string;
  // Whether this column can be used in a WHERE filter
  filterable?: boolean;
}

export interface QueryTemplate {
  // The intent this template satisfies
  intent: QueryIntent;
  // Human-readable description sent to the LLM as context
  description: string;
  // Table to query (must be in TABLE_REGISTRY)
  table: string;
  // Columns the SELECT may include
  allowedColumns: ColumnDef[];
  // Predefined aggregation SQL fragment — never interpolated from user input
  aggregation?: string;
  // Predefined WHERE clause fragment with $n placeholders
  defaultFilter?: string;
  // Default bind parameters for defaultFilter
  defaultParams?: (string | number)[];
  // ORDER BY clause
  orderBy?: string;
  // Hard cap on rows returned — prevents huge payloads to the LLM
  maxRows: number;
}

// ── Allowed tables whitelist ───────────────────────────────────────────────────
// Any table NOT in this set will be rejected before a query is built.

export const ALLOWED_TABLES = new Set([
  'invoices',
  'expenses',
  'bank_transactions',
  'contacts',
  'products',
  'anomalies',
]);

// ── Query templates registry ───────────────────────────────────────────────────
// Each intent maps to exactly one query template.
// The DynamicQueryBuilder reads these — it never constructs SQL from scratch.

export const QUERY_TEMPLATES: Record<QueryIntent, QueryTemplate> = {
  cash_position: {
    intent: 'cash_position',
    description: 'Current cash balance derived from bank transactions (credits minus debits)',
    table: 'bank_transactions',
    allowedColumns: [
      { name: 'type', alias: 'transaction_type', filterable: true },
      { name: 'amount', alias: 'amount' },
      { name: 'currency', alias: 'currency', filterable: true },
      { name: 'transaction_date', alias: 'date', filterable: true },
    ],
    aggregation: `
      SELECT
        currency,
        SUM(CASE WHEN type = 'credit' THEN amount ELSE -amount END) AS balance,
        MAX(transaction_date) AS as_of
      FROM bank_transactions
      GROUP BY currency
      ORDER BY balance DESC
    `,
    maxRows: 5,
  },

  revenue_trend: {
    intent: 'revenue_trend',
    description: 'Monthly revenue from paid invoices grouped by month and year',
    table: 'invoices',
    allowedColumns: [
      { name: 'amount', alias: 'amount' },
      { name: 'currency', alias: 'currency', filterable: true },
      { name: 'invoice_date', alias: 'date', filterable: true },
      { name: 'status', alias: 'status', filterable: true },
    ],
    aggregation: `
      SELECT
        EXTRACT(YEAR  FROM invoice_date)::int AS year,
        EXTRACT(MONTH FROM invoice_date)::int AS month,
        currency,
        SUM(amount) AS revenue
      FROM invoices
      WHERE status = 'paid'
        AND invoice_date >= NOW() - INTERVAL '24 months'
      GROUP BY year, month, currency
      ORDER BY year, month
    `,
    maxRows: 24,
  },

  expense_breakdown: {
    intent: 'expense_breakdown',
    description: 'Total expenses grouped by category for a given period',
    table: 'expenses',
    allowedColumns: [
      { name: 'category', alias: 'category', filterable: true },
      { name: 'amount', alias: 'amount' },
      { name: 'currency', alias: 'currency', filterable: true },
      { name: 'expense_date', alias: 'date', filterable: true },
      { name: 'description', alias: 'description' },
    ],
    aggregation: `
      SELECT
        category,
        currency,
        SUM(amount)   AS total,
        COUNT(*)      AS count,
        MIN(amount)   AS min_amount,
        MAX(amount)   AS max_amount,
        AVG(amount)   AS avg_amount
      FROM expenses
      WHERE expense_date >= $1
        AND expense_date <= $2
      GROUP BY category, currency
      ORDER BY total DESC
    `,
    defaultFilter: 'expense_date >= $1 AND expense_date <= $2',
    defaultParams: [
      new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(),
      new Date().toISOString(),
    ],
    maxRows: 20,
  },

  invoice_summary: {
    intent: 'invoice_summary',
    description: 'Summary of invoices grouped by status with totals',
    table: 'invoices',
    allowedColumns: [
      { name: 'status', alias: 'status', filterable: true },
      { name: 'amount', alias: 'amount' },
      { name: 'currency', alias: 'currency', filterable: true },
      { name: 'invoice_date', alias: 'date', filterable: true },
      { name: 'due_date', alias: 'due_date', filterable: true },
    ],
    aggregation: `
      SELECT
        status,
        currency,
        COUNT(*)    AS count,
        SUM(amount) AS total,
        MIN(amount) AS min_amount,
        MAX(amount) AS max_amount
      FROM invoices
      GROUP BY status, currency
      ORDER BY total DESC
    `,
    maxRows: 10,
  },

  overdue_invoices: {
    intent: 'overdue_invoices',
    description: 'Invoices that are overdue — unpaid past their due date',
    table: 'invoices',
    allowedColumns: [
      { name: 'external_id', alias: 'invoice_id' },
      { name: 'amount', alias: 'amount' },
      { name: 'currency', alias: 'currency', filterable: true },
      { name: 'invoice_date', alias: 'issued_on', filterable: true },
      { name: 'due_date', alias: 'due_on', filterable: true },
      { name: 'status', alias: 'status', filterable: true },
    ],
    aggregation: `
      SELECT
        external_id  AS invoice_id,
        amount,
        currency,
        invoice_date AS issued_on,
        due_date     AS due_on,
        NOW() - due_date AS overdue_by
      FROM invoices
      WHERE status = 'overdue'
      ORDER BY due_date ASC
    `,
    maxRows: 20,
  },

  bank_transactions: {
    intent: 'bank_transactions',
    description: 'Recent bank transactions showing credits and debits',
    table: 'bank_transactions',
    allowedColumns: [
      { name: 'type', alias: 'type', filterable: true },
      { name: 'amount', alias: 'amount' },
      { name: 'currency', alias: 'currency', filterable: true },
      { name: 'transaction_date', alias: 'date', filterable: true },
      { name: 'description', alias: 'description' },
      { name: 'reference', alias: 'reference' },
    ],
    aggregation: `
      SELECT
        type,
        amount,
        currency,
        transaction_date AS date,
        description,
        reference
      FROM bank_transactions
      WHERE transaction_date >= NOW() - INTERVAL '90 days'
      ORDER BY transaction_date DESC
    `,
    maxRows: 50,
  },

  product_inventory: {
    intent: 'product_inventory',
    description: 'Product catalog with current stock levels and prices',
    table: 'products',
    allowedColumns: [
      { name: 'name', alias: 'product_name' },
      { name: 'external_id', alias: 'sku', filterable: true },
      { name: 'price', alias: 'price' },
      { name: 'stock', alias: 'stock_level' },
    ],
    aggregation: `
      SELECT
        name         AS product_name,
        external_id  AS sku,
        price,
        stock        AS stock_level
      FROM products
      ORDER BY stock ASC
    `,
    maxRows: 50,
  },

  anomaly_summary: {
    intent: 'anomaly_summary',
    description: 'Detected financial anomalies ordered by confidence score',
    table: 'anomalies',
    allowedColumns: [
      { name: 'type', alias: 'anomaly_type', filterable: true },
      { name: 'score', alias: 'score', filterable: true },
      { name: 'confidence', alias: 'confidence', filterable: true },
      { name: 'explanation', alias: 'explanation' },
      { name: 'detected_at', alias: 'detected_at', filterable: true },
    ],
    aggregation: `
      SELECT
        type        AS anomaly_type,
        score,
        confidence,
        explanation,
        detected_at
      FROM anomalies
      WHERE score >= $1
      ORDER BY score DESC
    `,
    defaultFilter: 'score >= $1',
    defaultParams: [0.6],
    maxRows: 10,
  },

  contact_list: {
    intent: 'contact_list',
    description: 'Contacts (vendors, customers, suppliers) in the system',
    table: 'contacts',
    allowedColumns: [
      { name: 'name', alias: 'name' },
      { name: 'type', alias: 'contact_type', filterable: true },
      { name: 'external_id', alias: 'external_id', filterable: true },
    ],
    aggregation: `
      SELECT
        name,
        type  AS contact_type,
        external_id
      FROM contacts
      ORDER BY type, name
    `,
    maxRows: 100,
  },
};
