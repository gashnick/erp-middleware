import { Request } from 'express';

export function ipFromRequest(req: { ip?: string }): string {
  return req.ip ?? 'unknown';
}

export function uaFromRequest(req: {
  headers?: Record<string, string | string[] | undefined>;
}): string {
  const ua = req.headers?.['user-agent'];
  return Array.isArray(ua) ? ua[0] : (ua ?? 'unknown');
}

/** Convenience builder for system/job-originated audit entries. */
export function systemAuditMeta(): { ipAddress: string; userAgent: string } {
  return { ipAddress: 'system', userAgent: 'system-job' };
}
