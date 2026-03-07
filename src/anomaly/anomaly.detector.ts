// src/anomaly/anomaly.detector.ts
//
// Responsibility: pure statistical detection — no DB access, no side effects.
//
// Important: PostgreSQL numeric aggregates (SUM, AVG) are returned as strings
// by the Node.js pg driver. All incoming numeric fields must be cast with
// Number() before arithmetic to prevent NaN propagation through mean/stddev/z-score.

import { Injectable } from '@nestjs/common';
import { AnomalyCandidate, VendorSpend, DuplicateCandidate, PaymentRecord } from './anomaly.types';

const SPIKE_Z_THRESHOLD = 2.5;

@Injectable()
export class AnomalyDetector {
  private mean(values: number[]): number {
    if (!values.length) return 0;
    return values.reduce((s, v) => s + v, 0) / values.length;
  }

  private stddev(values: number[], avg: number): number {
    if (values.length < 2) return 0;
    return Math.sqrt(values.reduce((s, v) => s + (v - avg) ** 2, 0) / values.length);
  }

  private zScore(value: number, avg: number, sd: number): number {
    return sd === 0 ? 0 : (value - avg) / sd;
  }

  private iqrBounds(values: number[]): { lower: number; upper: number } {
    const sorted = [...values].sort((a, b) => a - b);
    const q1 = sorted[Math.floor(sorted.length * 0.25)];
    const q3 = sorted[Math.floor(sorted.length * 0.75)];
    const iqr = q3 - q1;
    return { lower: q1 - 1.5 * iqr, upper: q3 + 1.5 * iqr };
  }

  detectExpenseSpikes(
    tenantId: string,
    vendorSpends: VendorSpend[],
    threshold = SPIKE_Z_THRESHOLD,
  ): AnomalyCandidate[] {
    const byVendor = new Map<string, VendorSpend[]>();
    for (const s of vendorSpends) {
      const list = byVendor.get(s.vendorId) ?? [];
      list.push(s);
      byVendor.set(s.vendorId, list);
    }

    const anomalies: AnomalyCandidate[] = [];
    for (const [vendorId, spends] of byVendor) {
      if (spends.length < 3) continue;

      // Cast to Number — PostgreSQL SUM() returns strings via the pg driver.
      // Without this, all arithmetic produces NaN which fails the DB check constraint.
      const amounts = spends.map((s) => Number(s.spend));

      const latest = amounts[amounts.length - 1];
      const history = amounts.slice(0, -1);
      const avg = this.mean(history);
      const sd = this.stddev(history, avg);
      const z = this.zScore(latest, avg, sd);
      if (z <= threshold) continue;

      const pctAbove = avg > 0 ? Math.round(((latest - avg) / avg) * 100) : 0;
      const vendorName = spends[spends.length - 1].vendorName;

      anomalies.push({
        tenantId,
        type: 'EXPENSE_SPIKE',
        score: Math.min(1, z / 5),
        confidence: Math.min(1, (spends.length - 2) / 10 + 0.5),
        explanation: `Vendor "${vendorName}" spend is ${pctAbove}% above the ${history.length}-month average (z-score: ${z.toFixed(2)}).`,
        relatedIds: [vendorId],
        detectedAt: new Date(),
      });
    }
    return anomalies;
  }

  detectDuplicateInvoices(tenantId: string, candidates: DuplicateCandidate[]): AnomalyCandidate[] {
    return candidates
      .filter((c) => c.invoiceIds.length > 1)
      .map((c) => ({
        tenantId,
        type: 'DUPLICATE_INVOICE' as const,
        score: 0.95,
        confidence: 0.98,
        explanation: `${c.invoiceIds.length} invoices share the same vendor, amount, and date window (fingerprint: ${c.fingerprint.slice(0, 8)}…).`,
        relatedIds: c.invoiceIds,
        detectedAt: new Date(),
      }));
  }

  detectUnusualPayments(tenantId: string, payments: PaymentRecord[]): AnomalyCandidate[] {
    if (payments.length < 10) return [];

    // Cast to Number — pg driver returns numeric columns as strings
    const amounts = payments.map((p) => Number(p.amount));
    const hours = payments.map((p) => Number(p.hour));

    const { upper: amtCeil } = this.iqrBounds(amounts);
    const { lower: hrLow, upper: hrHigh } = this.iqrBounds(hours);

    return payments.flatMap((p) => {
      const amount = Number(p.amount);
      const hour = Number(p.hour);

      const amountFlag = amount > amtCeil;
      const hourFlag = hour < hrLow || hour > hrHigh;
      if (!amountFlag && !hourFlag) return [];

      const reasons: string[] = [];
      if (amountFlag)
        reasons.push(`amount $${amount.toFixed(2)} exceeds IQR ceiling $${amtCeil.toFixed(2)}`);
      if (hourFlag)
        reasons.push(
          `processed at hour ${hour} (normal window ${Math.round(hrLow)}–${Math.round(hrHigh)})`,
        );

      return [
        {
          tenantId,
          type: 'UNUSUAL_PAYMENT' as const,
          score: Math.min(1, (amountFlag ? 0.5 : 0) + (hourFlag ? 0.3 : 0)),
          confidence: 0.7,
          explanation: `Payment ${p.id}: ${reasons.join(' and ')}.`,
          relatedIds: [p.id],
          detectedAt: new Date(),
        },
      ];
    });
  }
}
