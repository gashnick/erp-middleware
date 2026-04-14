// src/whatsapp/whatsapp.types.ts

// ── DB shapes ─────────────────────────────────────────────────────────────────

export interface WhatsAppConfig {
  id: string;
  phoneNumber: string;
  wabaId: string;
  accessToken: string; // encrypted at rest — never returned raw in API responses
  appSecret: string; // encrypted at rest — used for HMAC webhook verification
  isVerified: boolean;
  isActive: boolean;
  webhookVerifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WhatsAppSession {
  id: string;
  phoneNumber: string;
  userId: string | null;
  chatSessionId: string | null;
  context: Record<string, unknown>;
  lastMessageAt: string;
  createdAt: string;
  updatedAt: string;
  // OTP linking fields (added in migration 1705000000011)
  pendingOtp: string | null;
  otpExpiresAt: string | null;
}

export interface GenerateOtpResult {
  otp: string; // shown to user in the app — they send this via WhatsApp
  expiresAt: string; // ISO timestamp — show countdown in the UI
  phoneHint: string; // e.g. "+254 7XX XXX 111" — masked for display
}

export interface LinkStatusResult {
  linked: boolean;
  phoneNumber: string | null;
  linkedAt: string | null; // when user_id was written — last_message_at as proxy
}

// ── DTOs ──────────────────────────────────────────────────────────────────────

export interface CreateWhatsAppConfigDto {
  phoneNumber: string;
  wabaId: string;
  accessToken: string; // plain text — encrypted before storage
  appSecret: string; // plain text — encrypted before storage
}

export interface UpdateWhatsAppConfigDto {
  accessToken?: string;
  appSecret?: string;
  isActive?: boolean;
}

// ── Meta Graph API payload shapes ─────────────────────────────────────────────
// Reference: https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks

export interface MetaWebhookBody {
  object: string; // always 'whatsapp_business_account'
  entry: MetaWebhookEntry[];
}

export interface MetaWebhookEntry {
  id: string; // WABA ID
  changes: MetaWebhookChange[];
}

export interface MetaWebhookChange {
  value: MetaWebhookValue;
  field: string; // always 'messages'
}

export interface MetaWebhookValue {
  messaging_product: string;
  metadata: {
    display_phone_number: string;
    phone_number_id: string;
  };
  contacts?: MetaContact[];
  messages?: MetaMessage[];
  statuses?: MetaStatus[];
}

export interface MetaContact {
  profile: { name: string };
  wa_id: string;
}

export interface MetaMessage {
  from: string; // sender's phone number
  id: string; // message ID for deduplication
  timestamp: string;
  type: 'text' | 'image' | 'audio' | 'document' | 'interactive' | 'reaction';
  text?: { body: string };
}

export interface MetaStatus {
  id: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  timestamp: string;
  recipient_id: string;
}

// ── Outbound message shapes ───────────────────────────────────────────────────

export interface SendTextPayload {
  messaging_product: 'whatsapp';
  recipient_type: 'individual';
  to: string;
  type: 'text';
  text: { body: string; preview_url?: boolean };
}

export interface SendTemplatePayload {
  messaging_product: 'whatsapp';
  recipient_type: 'individual';
  to: string;
  type: 'template';
  template: {
    name: string;
    language: { code: string };
    components?: MetaTemplateComponent[];
  };
}

export interface MetaTemplateComponent {
  type: 'header' | 'body' | 'button';
  parameters: Array<{ type: 'text'; text: string }>;
}

// ── Template param shapes ─────────────────────────────────────────────────────

export interface AlertTemplateParams {
  ruleName: string;
  metric: string;
  actualValue: number;
  threshold: number;
  severity: string;
}

export interface ReportReadyTemplateParams {
  reportName: string;
  periodLabel: string;
  downloadUrl: string;
  format: string;
}
