// src/reports/email.service.ts
//
// Thin nodemailer wrapper for sending report emails.
//
// Reads SMTP configuration from environment variables:
//   SMTP_HOST     — e.g. smtp.gmail.com
//   SMTP_PORT     — e.g. 587
//   SMTP_SECURE   — 'true' for port 465, 'false' for STARTTLS
//   SMTP_USER     — sender email address
//   SMTP_PASS     — sender password or app password
//   SMTP_FROM     — display name + address, e.g. "CID Reports <reports@cid.io>"
//
// Fail-open: a failed email never crashes the scheduler or blocks the response.
// The caller receives { success: false, error } and can decide what to do.

import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { Transporter } from 'nodemailer';

export interface SendReportEmailOptions {
  to: string[];
  subject: string;
  html: string;
  attachments?: Array<{
    filename: string;
    content: Buffer;
    contentType: string;
  }>;
}

export interface EmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly transporter: Transporter;
  private readonly from: string;

  constructor() {
    this.from = process.env.SMTP_FROM ?? 'CID Reports <reports@cid.io>';

    this.transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST ?? 'smtp.gmail.com',
      port: parseInt(process.env.SMTP_PORT ?? '587', 10),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER ?? '',
        pass: process.env.SMTP_PASS ?? '',
      },
    });
  }

  /**
   * Sends a report email with optional file attachment.
   * Fails open — never throws. Returns { success, error } instead.
   */
  async sendReport(opts: SendReportEmailOptions): Promise<EmailResult> {
    try {
      const info = await this.transporter.sendMail({
        from: this.from,
        to: opts.to.join(', '),
        subject: opts.subject,
        html: opts.html,
        attachments: opts.attachments ?? [],
      });

      this.logger.log(`Email sent to ${opts.to.join(', ')} — messageId=${info.messageId}`);
      return { success: true, messageId: info.messageId };
    } catch (err) {
      this.logger.error(`Failed to send email to ${opts.to.join(', ')}: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  /**
   * Verifies SMTP connection. Called on module init so misconfiguration
   * is caught at startup rather than at the first scheduled send.
   */
  async verifyConnection(): Promise<boolean> {
    try {
      await this.transporter.verify();
      this.logger.log('SMTP connection verified');
      return true;
    } catch (err) {
      this.logger.warn(`SMTP connection failed: ${err.message} — emails will not be sent`);
      return false;
    }
  }
}
