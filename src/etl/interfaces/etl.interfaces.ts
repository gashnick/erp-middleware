// src/etl/interfaces/etl.interfaces.ts

/**
 * Represents a single record that failed during a batch retry attempt.
 */
export interface FailedRetry {
  id: string;
  errors: any;
}

/**
 * The standard response structure for batch ETL operations.
 */
export interface BatchRetryResult {
  totalProcessed: number;
  succeeded: number;
  failed: FailedRetry[];
}

/**
 * Internal result for individual transformation logic.
 */
export interface TransformationResult<T, Q> {
  validInvoices: T[];
  quarantine: Partial<Q>[];
}
