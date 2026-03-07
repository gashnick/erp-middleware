// src/chat/dynamic-query/query-intent.service.ts
//
// Classifies a natural-language question into one or more QueryIntents.
//
// Design decisions:
//  • Pure keyword scoring — deterministic, zero latency, no external calls.
//  • Returns intents in priority order so callers can fetch the most relevant
//    data first and stop early if token budget is reached.
//  • Multiple intents are allowed — a question like "What are our overdue
//    invoices and current cash?" maps to both overdue_invoices + cash_position.

import { Injectable, Logger } from '@nestjs/common';
import { QueryIntent } from './table-registry';

// ── Keyword → intent scoring map ─────────────────────────────────────────────
// Each entry awards `weight` points to the intent when its keywords appear
// in the question (case-insensitive, whole-word match).

interface ScoringRule {
  keywords: string[];
  intent: QueryIntent;
  weight: number;
}

const SCORING_RULES: ScoringRule[] = [
  // Cash / liquidity
  {
    intent: 'cash_position',
    weight: 10,
    keywords: ['cash', 'balance', 'liquidity', 'bank balance', 'available funds'],
  },
  { intent: 'cash_position', weight: 5, keywords: ['how much money', 'funds', 'account'] },

  // Revenue / income
  {
    intent: 'revenue_trend',
    weight: 10,
    keywords: ['revenue', 'income', 'earnings', 'sales', 'collected'],
  },
  {
    intent: 'revenue_trend',
    weight: 5,
    keywords: ['monthly', 'ytd', 'year to date', 'trend', 'growth'],
  },

  // Expenses / spending
  {
    intent: 'expense_breakdown',
    weight: 10,
    keywords: ['expense', 'spending', 'cost', 'costs', 'expenditure', 'outgoing'],
  },
  {
    intent: 'expense_breakdown',
    weight: 5,
    keywords: ['category', 'breakdown', 'where did we spend', 'biggest cost'],
  },

  // Invoices general
  { intent: 'invoice_summary', weight: 10, keywords: ['invoice', 'invoices', 'billing', 'billed'] },
  { intent: 'invoice_summary', weight: 5, keywords: ['paid', 'unpaid', 'draft', 'sent'] },

  // Overdue specifically
  {
    intent: 'overdue_invoices',
    weight: 15,
    keywords: ['overdue', 'late', 'past due', 'outstanding', 'delinquent'],
  },
  {
    intent: 'overdue_invoices',
    weight: 5,
    keywords: ['not paid', 'unpaid invoice', 'missed payment'],
  },

  // Bank transactions
  {
    intent: 'bank_transactions',
    weight: 10,
    keywords: ['transaction', 'transactions', 'bank', 'transfer', 'deposit', 'withdrawal'],
  },
  {
    intent: 'bank_transactions',
    weight: 5,
    keywords: ['debit', 'credit', 'payment received', 'payment sent'],
  },

  // Products / inventory
  {
    intent: 'product_inventory',
    weight: 10,
    keywords: ['product', 'products', 'inventory', 'stock', 'sku', 'catalog'],
  },
  {
    intent: 'product_inventory',
    weight: 5,
    keywords: ['item', 'items', 'quantity', 'in stock', 'out of stock'],
  },

  // Anomalies / alerts
  {
    intent: 'anomaly_summary',
    weight: 10,
    keywords: ['anomaly', 'anomalies', 'unusual', 'suspicious', 'alert', 'flag', 'duplicate'],
  },
  {
    intent: 'anomaly_summary',
    weight: 5,
    keywords: ['spike', 'outlier', 'irregular', 'unexpected', 'weird'],
  },

  // Contacts / vendors / customers
  {
    intent: 'contact_list',
    weight: 10,
    keywords: ['contact', 'contacts', 'vendor', 'vendors', 'customer', 'customers', 'supplier'],
  },
  {
    intent: 'contact_list',
    weight: 5,
    keywords: ['partner', 'client', 'clients', 'who do we buy from', 'who do we sell to'],
  },
];

// Minimum score for an intent to be included in results
const MIN_SCORE_THRESHOLD = 5;

// Maximum number of intents to return — prevents over-fetching
const MAX_INTENTS = 3;

@Injectable()
export class QueryIntentService {
  private readonly logger = new Logger(QueryIntentService.name);

  /**
   * Classifies a question into ordered QueryIntents.
   * Returns an empty array if no intent scores above the threshold —
   * the caller should fall back to the static KPI snapshot in that case.
   */
  classify(question: string): QueryIntent[] {
    const normalised = question.toLowerCase().trim();
    const scores = new Map<QueryIntent, number>();

    for (const rule of SCORING_RULES) {
      for (const keyword of rule.keywords) {
        if (normalised.includes(keyword)) {
          const current = scores.get(rule.intent) ?? 0;
          scores.set(rule.intent, current + rule.weight);
        }
      }
    }

    const ranked = Array.from(scores.entries())
      .filter(([, score]) => score >= MIN_SCORE_THRESHOLD)
      .sort(([, a], [, b]) => b - a)
      .slice(0, MAX_INTENTS)
      .map(([intent]) => intent);

    this.logger.debug(
      `Intent classification for "${question.slice(0, 60)}…": [${ranked.join(', ')}]`,
    );

    return ranked;
  }

  /**
   * Returns true when the question is a broad "give me everything" request
   * that should use the full KPI snapshot instead of targeted queries.
   */
  isBroadOverview(question: string): boolean {
    const normalised = question.toLowerCase();
    const broadKeywords = [
      'overview',
      'summary',
      'dashboard',
      'how are we doing',
      'financial health',
      'general',
      'everything',
      'all data',
    ];
    return broadKeywords.some((kw) => normalised.includes(kw));
  }
}
