// src/whatsapp/whatsapp-template.service.ts
//
// Renders WhatsApp message content for all outbound scenarios.
//
// WhatsApp Business API has two message modes:
//
//   1. Template messages — pre-approved by Meta, used for proactive outbound
//      (alerts, report delivery). Required when messaging a user who hasn't
//      messaged you in the last 24 hours.
//
//   2. Free-form text — used for replies within a 24-hour conversation window.
//      This is what LLM chat responses use.
//
// This service builds the payload objects that WhatsAppService sends to Meta.
// It has no network calls — pure data transformation.

import { Injectable } from '@nestjs/common';
import {
  SendTemplatePayload,
  AlertTemplateParams,
  ReportReadyTemplateParams,
} from './whatsapp.types';

// Severity → emoji — matches AlertNotifierService exactly
const SEVERITY_EMOJI: Record<string, string> = {
  low: 'ℹ️',
  medium: '⚠️',
  high: '🔴',
  critical: '🚨',
};

@Injectable()
export class WhatsAppTemplateService {
  /**
   * Builds a template payload for an alert breach notification.
   *
   * Meta template name: 'alert_notification'
   * Expected template body (register in Meta Business Manager):
   *   "{{1}} Alert: {{2}} — {{3}} is {{4}} (threshold: {{5}})"
   *
   * Falls back to free-form text string if template not approved yet.
   * Caller decides which send method to use based on the 24h window.
   */
  buildAlertNotification(to: string, params: AlertTemplateParams): SendTemplatePayload {
    const emoji = SEVERITY_EMOJI[params.severity] ?? '⚠️';

    return {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'template',
      template: {
        name: 'alert_notification',
        language: { code: 'en_US' },
        components: [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: emoji },
              { type: 'text', text: params.ruleName },
              { type: 'text', text: params.metric.replace(/_/g, ' ') },
              { type: 'text', text: String(params.actualValue) },
              { type: 'text', text: String(params.threshold) },
            ],
          },
        ],
      },
    };
  }

  /**
   * Builds a template payload for a report-ready notification.
   *
   * Meta template name: 'report_ready'
   * Expected template body:
   *   "Your {{1}} report for {{2}} is ready. Download ({{3}} format): {{4}}"
   */
  buildReportReady(to: string, params: ReportReadyTemplateParams): SendTemplatePayload {
    return {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'template',
      template: {
        name: 'report_ready',
        language: { code: 'en_US' },
        components: [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: params.reportName },
              { type: 'text', text: params.periodLabel },
              { type: 'text', text: params.format.toUpperCase() },
              { type: 'text', text: params.downloadUrl },
            ],
          },
        ],
      },
    };
  }

  /**
   * Formats a plain-text LLM reply for WhatsApp.
   * WhatsApp supports basic markdown: *bold*, _italic_, ~strikethrough~, ```code```.
   * We strip HTML tags and trim to WhatsApp's 4096 char limit.
   */
  formatChatReply(text: string): string {
    return text
      .replace(/<[^>]+>/g, '') // strip HTML
      .replace(/\*\*/g, '*') // markdown bold: ** → *
      .replace(/#{1,6}\s/g, '*') // headings → bold
      .substring(0, 4096)
      .trim();
  }

  /**
   * Builds a help/menu message sent when a user first messages or types 'help'.
   */
  buildWelcomeMessage(tenantName?: string): string {
    const name = tenantName ? ` for ${tenantName}` : '';
    return (
      `👋 Welcome to CID ERP Assistant${name}!\n\n` +
      `You can ask me questions like:\n` +
      `• "What is our cash balance?"\n` +
      `• "How many employees do we have?"\n` +
      `• "Are there any SLA breaches?"\n` +
      `• "Show me overdue invoices"\n\n` +
      `Just type your question and I'll respond instantly.\n\n` +
      `Type *help* at any time to see this menu again.`
    );
  }
}
