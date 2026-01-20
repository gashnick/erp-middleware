import { SetMetadata } from '@nestjs/common';

// These keys must match the column names in your subscription_plans table
export type PlanLimitKey = 'max_users' | 'max_monthly_invoices' | 'max_storage_gb';

export const CheckLimit = (limitKey: PlanLimitKey) => SetMetadata('planLimitKey', limitKey);
