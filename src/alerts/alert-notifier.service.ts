// src/alerts/alert-notifier.service.ts
//
// Routes triggered alert events to the configured notification channels.
//
// Current channel implementations:
//   in_app   — stores notification in alert_events metadata (always done)
//   email    — placeholder, will be wired to Nodemailer/SendGrid in Stream 5
//   whatsapp — placeholder, will be wired to WhatsApp Business API in Stream 6
//
// Designed for graceful partial failure — if email fails, WhatsApp still fires.
// Each channel is independent and errors are logged but never re-thrown.

import { Injectable, Logger } from '@nestjs/common';
import { AlertSeverity, AlertChannel } from './alert.types';

export interface NotifyPayload {
  ruleId: string;
  ruleName: string;
  metric: string;
  actualValue: number;
  threshold: number;
  severity: AlertSeverity;
  channels: AlertChannel[];
  tenantId: string;
}

// Severity → emoji for notification messages
const SEVERITY_EMOJI: Record<AlertSeverity, string> = {
  low: 'ℹ️',
  medium: '⚠️',
  high: '🔴',
  critical: '🚨',
};

@Injectable()
export class AlertNotifierService {
  private readonly logger = new Logger(AlertNotifierService.name);

  async notify(payload: NotifyPayload): Promise<void> {
    const message = this.buildMessage(payload);

    // Run all channel notifications in parallel — independent failures
    const results = await Promise.allSettled(
      payload.channels.map((channel) => this.notifyChannel(channel, payload, message)),
    );

    // Log any failures without throwing
    results.forEach((result, i) => {
      if (result.status === 'rejected') {
        this.logger.error(
          `Channel '${payload.channels[i]}' notification failed: ${result.reason?.message}`,
        );
      }
    });
  }

  // ── Channel handlers ───────────────────────────────────────────────────────

  private async notifyChannel(
    channel: AlertChannel,
    payload: NotifyPayload,
    message: string,
  ): Promise<void> {
    switch (channel) {
      case 'in_app':
        return this.notifyInApp(payload, message);
      case 'email':
        return this.notifyEmail(payload, message);
      case 'whatsapp':
        return this.notifyWhatsApp(payload, message);
    }
  }

  private async notifyInApp(payload: NotifyPayload, message: string): Promise<void> {
    // In-app notifications are handled by the alert_events table itself.
    // The frontend polls GET /api/alerts/events?status=open to show badges.
    // This method is a no-op — the event was already created by the evaluator.
    this.logger.log(`[in_app] ${SEVERITY_EMOJI[payload.severity]} ${message}`);
  }

  private async notifyEmail(payload: NotifyPayload, message: string): Promise<void> {
    // TODO Stream 5 — wire to Nodemailer/SendGrid
    // Will use report_schedules recipient list for routing
    this.logger.log(`[email] PLACEHOLDER — would send to tenant ${payload.tenantId}: ${message}`);
  }

  private async notifyWhatsApp(payload: NotifyPayload, message: string): Promise<void> {
    // TODO Stream 6 — wire to WhatsApp Business API
    // Will use whatsapp_configs table for business number lookup
    this.logger.log(
      `[whatsapp] PLACEHOLDER — would send to tenant ${payload.tenantId}: ${message}`,
    );
  }

  // ── Message builder ────────────────────────────────────────────────────────

  private buildMessage(payload: NotifyPayload): string {
    const emoji = SEVERITY_EMOJI[payload.severity];
    const metricLabel = payload.metric.replace(/_/g, ' ').toUpperCase();
    return (
      `${emoji} Alert: "${payload.ruleName}" — ` +
      `${metricLabel} is ${payload.actualValue} ` +
      `(threshold: ${payload.threshold}) ` +
      `[${payload.severity.toUpperCase()}]`
    );
  }
}
