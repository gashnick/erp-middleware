// src/reports/cron-helper.service.ts
//
// Converts frontend simple interval selections into cron expressions,
// and validates arbitrary cron strings before they are stored.
//
// Cron format used: standard 5-field POSIX cron
//   ┌─ minute (0–59)
//   │ ┌─ hour (0–23)
//   │ │ ┌─ day of month (1–31)
//   │ │ │ ┌─ month (1–12)
//   │ │ │ │ ┌─ day of week (0–7, 0 and 7 = Sunday)
//   * * * * *
//
// Simple → cron mappings:
//   daily   → "0 {hour} * * *"           every day at {hour}:00
//   weekly  → "0 {hour} * * {dayOfWeek}" every {day} at {hour}:00
//   monthly → "0 {hour} {dayOfMonth} * *" on the {day}th of every month

import { Injectable, BadRequestException } from '@nestjs/common';
import { SimpleInterval, CreateReportScheduleDto } from './reports.types';

@Injectable()
export class CronHelperService {
  /**
   * Resolves the final cron string from a CreateReportScheduleDto.
   *
   * Priority:
   *   1. dto.cron        — advanced input, validated then returned as-is
   *   2. dto.interval    — converted to cron via intervalToCron()
   *   3. default         — daily at 08:00 ('0 8 * * *')
   */
  resolve(
    dto: Pick<CreateReportScheduleDto, 'cron' | 'interval' | 'hour' | 'dayOfWeek' | 'dayOfMonth'>,
  ): string {
    if (dto.cron?.trim()) {
      this.validate(dto.cron.trim());
      return dto.cron.trim();
    }

    if (dto.interval) {
      return this.intervalToCron(dto.interval, {
        hour: dto.hour ?? 8,
        dayOfWeek: dto.dayOfWeek ?? 1, // Monday
        dayOfMonth: dto.dayOfMonth ?? 1,
      });
    }

    return '0 8 * * 1'; // default: every Monday at 08:00
  }

  /**
   * Converts a simple interval selection to a 5-field cron string.
   */
  intervalToCron(
    interval: SimpleInterval,
    opts: { hour: number; dayOfWeek: number; dayOfMonth: number },
  ): string {
    const h = this.clamp(opts.hour, 0, 23);

    switch (interval) {
      case 'daily':
        return `0 ${h} * * *`;

      case 'weekly': {
        const dow = this.clamp(opts.dayOfWeek, 0, 6);
        return `0 ${h} * * ${dow}`;
      }

      case 'monthly': {
        const dom = this.clamp(opts.dayOfMonth, 1, 28); // cap at 28 — safe for all months
        return `0 ${h} ${dom} * *`;
      }
    }
  }

  /**
   * Validates a 5-field cron string.
   * Throws BadRequestException with a human-readable message on failure.
   *
   * Checks:
   *   - Exactly 5 fields
   *   - Each field matches its allowed pattern (numbers, *, ranges, steps)
   *   - Numeric values are within their valid range
   */
  validate(cron: string): void {
    const fields = cron.trim().split(/\s+/);

    if (fields.length !== 5) {
      throw new BadRequestException(
        `Invalid cron expression "${cron}": expected 5 fields, got ${fields.length}. ` +
          `Example: "0 8 * * 1" (every Monday at 08:00)`,
      );
    }

    const ranges = [
      { name: 'minute', min: 0, max: 59 },
      { name: 'hour', min: 0, max: 23 },
      { name: 'day-of-month', min: 1, max: 31 },
      { name: 'month', min: 1, max: 12 },
      { name: 'day-of-week', min: 0, max: 7 },
    ];

    for (let i = 0; i < 5; i++) {
      const field = fields[i];
      const { name, min, max } = ranges[i];

      if (field === '*') continue;

      // Step values: */n or value/n
      if (field.includes('/')) {
        const [base, step] = field.split('/');
        if (base !== '*' && !this.isInRange(Number(base), min, max)) {
          throw new BadRequestException(
            `Invalid cron field "${field}" for ${name}: base value out of range [${min}–${max}]`,
          );
        }
        const stepNum = Number(step);
        if (isNaN(stepNum) || stepNum < 1) {
          throw new BadRequestException(
            `Invalid cron field "${field}" for ${name}: step must be a positive integer`,
          );
        }
        continue;
      }

      // Range: n-m
      if (field.includes('-')) {
        const [from, to] = field.split('-').map(Number);
        if (!this.isInRange(from, min, max) || !this.isInRange(to, min, max) || from > to) {
          throw new BadRequestException(
            `Invalid cron range "${field}" for ${name}: must be within [${min}–${max}]`,
          );
        }
        continue;
      }

      // List: n,m,p
      if (field.includes(',')) {
        const parts = field.split(',').map(Number);
        for (const p of parts) {
          if (!this.isInRange(p, min, max)) {
            throw new BadRequestException(
              `Invalid cron list value "${p}" for ${name}: must be within [${min}–${max}]`,
            );
          }
        }
        continue;
      }

      // Single number
      const num = Number(field);
      if (isNaN(num) || !this.isInRange(num, min, max)) {
        throw new BadRequestException(
          `Invalid cron value "${field}" for ${name}: must be within [${min}–${max}]`,
        );
      }
    }
  }

  /**
   * Computes the next Date a cron expression will fire after `after`.
   * Uses a simple minute-by-minute forward scan — accurate for scheduling
   * purposes without pulling in a heavy cron library.
   * Scan limit: 366 days. Throws if no match found (pathological expression).
   */
  nextRunAfter(cron: string, after: Date = new Date(), timezone = 'UTC'): Date {
    this.validate(cron);

    const [minuteF, hourF, domF, monthF, dowF] = cron.trim().split(/\s+/);

    // Start scanning from the next minute
    const cursor = new Date(after.getTime());
    cursor.setSeconds(0, 0);
    cursor.setMinutes(cursor.getMinutes() + 1);

    const limit = new Date(cursor.getTime() + 366 * 24 * 60 * 60 * 1000);

    while (cursor < limit) {
      if (
        this.fieldMatches(cursor.getUTCMinutes(), minuteF, 0, 59) &&
        this.fieldMatches(cursor.getUTCHours(), hourF, 0, 23) &&
        this.fieldMatches(cursor.getUTCDate(), domF, 1, 31) &&
        this.fieldMatches(cursor.getUTCMonth() + 1, monthF, 1, 12) &&
        this.fieldMatches(cursor.getUTCDay(), dowF, 0, 7)
      ) {
        return new Date(cursor);
      }
      cursor.setMinutes(cursor.getMinutes() + 1);
    }

    throw new BadRequestException(
      `Cron expression "${cron}" did not match within 366 days — check your expression`,
    );
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private fieldMatches(value: number, field: string, min: number, max: number): boolean {
    if (field === '*') return true;

    if (field.includes('/')) {
      const [base, step] = field.split('/');
      const stepNum = Number(step);
      const start = base === '*' ? min : Number(base);
      return value >= start && (value - start) % stepNum === 0;
    }

    if (field.includes('-')) {
      const [from, to] = field.split('-').map(Number);
      return value >= from && value <= to;
    }

    if (field.includes(',')) {
      return field.split(',').map(Number).includes(value);
    }

    // day-of-week: 7 is also Sunday (same as 0)
    const num = Number(field);
    return value === num || (field === '7' && value === 0);
  }

  private isInRange(n: number, min: number, max: number): boolean {
    return !isNaN(n) && n >= min && n <= max;
  }

  private clamp(n: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, n));
  }
}
