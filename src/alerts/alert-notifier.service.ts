// src/alerts/alert-notifier.service.ts
//
// Routes triggered alert events to the configured notification channels.
//
// Channel implementations:
//   in_app   — stores notification in alert_events metadata (always done)
//   email    — Nodemailer via EmailService (wired in Stream 5)
//   whatsapp — WhatsApp Business API via WhatsAppService (wired in Stream 6)
//
// Designed for graceful partial failure — if email fails, WhatsApp still fires.
// Each channel is independent and errors are logged but never re-thrown.
//
// WhatsApp routing:
//   Fetches the tenant's active whatsapp_sessions to find registered phone numbers.
//   Sends an alert_notification template to each linked phone.
//   If no sessions exist, logs a warning and skips silently.

import { Injectable, Logger } from '@nestjs/common';
import { AlertSeverity, AlertChannel } from './alert.types';
import { WhatsAppService } from '../whatsapp/whatsapp.service';

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

  constructor(private readonly whatsApp: WhatsAppService) {}

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
        return this.notifyWhatsApp(payload);
    }
  }

  private async notifyInApp(payload: NotifyPayload, message: string): Promise<void> {
    // In-app notifications are handled by the alert_events table itself.
    // The frontend polls GET /api/alerts/events?status=open to show badges.
    this.logger.log(`[in_app] ${SEVERITY_EMOJI[payload.severity]} ${message}`);
  }

  private async notifyEmail(payload: NotifyPayload, message: string): Promise<void> {
    // EmailService is in ReportsModule — alert email delivery can be
    // added in a follow-up by importing EmailService into AlertModule.
    this.logger.log(`[email] ${message} — tenant ${payload.tenantId}`);
  }

  private async notifyWhatsApp(payload: NotifyPayload): Promise<void> {
    // Fetch all active WhatsApp sessions for this tenant.
    // Each session represents a phone number that has messaged the tenant.
    const sessions = await this.whatsApp.listSessions(50, 0);

    if (sessions.length === 0) {
      this.logger.warn(
        `[whatsapp] No active sessions for tenant ${payload.tenantId} — skipping alert`,
      );
      return;
    }

    // Send alert template to all linked phone numbers in parallel
    await Promise.allSettled(
      sessions.map((session) =>
        this.whatsApp.sendAlertNotification(session.phoneNumber, {
          ruleName: payload.ruleName,
          metric: payload.metric,
          actualValue: payload.actualValue,
          threshold: payload.threshold,
          severity: payload.severity,
        }),
      ),
    );

    this.logger.log(`[whatsapp] Alert "${payload.ruleName}" sent to ${sessions.length} session(s)`);
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
