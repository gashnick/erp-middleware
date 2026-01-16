// // src/common/metrics/metrics.service.ts
// import { Injectable } from '@nestjs/common';
// import { Counter, Histogram } from 'prom-client';

// @Injectable()
// export class MetricsService {
//   private readonly tenantContextMissingCounter = new Counter({
//     name: 'tenant_context_missing_total',
//     help: 'Total number of requests with missing tenant context',
//   });

//   private readonly schemaSwitch Duration = new Histogram({
//     name: 'schema_switch_duration_seconds',
//     help: 'Time taken to switch schemas',
//     buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1],
//   });

//   recordMissingContext() {
//     this.tenantContextMissingCounter.inc();
//   }

//   recordSchemaSwitchDuration(duration: number) {
//     this.schemaSwitchDuration.observe(duration);
//   }
// }
