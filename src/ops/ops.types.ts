// src/ops/ops.types.ts
//
// Shared types for the Operations Dashboard module.
// No ORM entities — all data access uses raw parameterized queries.

// ── Asset types ──────────────────────────────────────────────────────────────

export type AssetStatus = 'operational' | 'maintenance' | 'offline' | 'retired';

export interface Asset {
  id: string;
  externalId: string | null;
  name: string;
  category: string;
  status: AssetStatus;
  uptimePct: number | null;
  lastService: string | null; // ISO date string
  nextService: string | null; // ISO date string
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface InventorySummary {
  total: number;
  operational: number;
  maintenance: number;
  offline: number;
  retired: number;
  byCategory: Array<{
    category: string;
    total: number;
    operational: number;
    avgUptimePct: number | null;
  }>;
}

// ── Orders pipeline types ─────────────────────────────────────────────────────

export interface OrdersPipelineItem {
  status: string;
  count: number;
  totalValue: number;
  avgValue: number;
}

export interface OrdersPipeline {
  totalOrders: number;
  totalValue: number;
  byStatus: OrdersPipelineItem[];
  byChannel: Array<{
    channel: string;
    count: number;
    totalValue: number;
  }>;
}

// ── SLA types ────────────────────────────────────────────────────────────────

export interface SlaConfig {
  id: string;
  name: string;
  metric: string;
  targetValue: number;
  warningPct: number; // e.g. 80 means warn at 80% of target
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SlaStatusItem extends SlaConfig {
  actualValue: number | null; // current measured value (null = no data yet)
  usedPct: number | null; // (actualValue / targetValue) * 100
  state: 'ok' | 'warning' | 'breached';
}

export interface SlaStatusResult {
  asOf: string;
  total: number;
  ok: number;
  warning: number;
  breached: number;
  items: SlaStatusItem[];
}

// ── DTOs ─────────────────────────────────────────────────────────────────────

export interface CreateSlaConfigDto {
  name: string;
  metric: string;
  targetValue: number;
  warningPct?: number; // default 80
}

export interface AssetFilters {
  category?: string;
  status?: AssetStatus;
  limit?: number;
  offset?: number;
}
