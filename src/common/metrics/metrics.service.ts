// src/common/metrics/metrics.service.ts
import { Injectable } from '@nestjs/common';
import { Counter, Histogram, register } from 'prom-client';

@Injectable()
export class MetricsService {
  // Tracks missing context (Security/Guard issues)
  private readonly tenantContextMissingCounter: Counter<string> =
    (register.getSingleMetric('tenant_context_missing_total') as Counter<string>) ||
    new Counter({
      name: 'tenant_context_missing_total',
      help: 'Total number of requests with missing tenant context',
    });

  // Tracks latency of switching schemas (Postgres Overhead)
  private readonly schemaSwitchDuration: Histogram<string> =
    (register.getSingleMetric('schema_switch_duration_seconds') as Histogram<string>) ||
    new Histogram({
      name: 'schema_switch_duration_seconds',
      help: 'Time taken to switch schemas per tenant',
      labelNames: ['tenant_id'],
      buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5], // Precise buckets for DB ops
    });

  recordMissingContext() {
    this.tenantContextMissingCounter.inc();
  }

  recordSchemaSwitchDuration(tenantId: string, duration: number) {
    this.schemaSwitchDuration.labels(tenantId).observe(duration);
  }
}
