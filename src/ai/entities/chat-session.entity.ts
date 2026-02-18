export class ChatSession {
  id: string;
  tenantId: string;
  userId: string;
  createdAt: Date;
  lastActivityAt: Date;
  messages: ChatMessage[];
  metadata: Record<string, any>;
}

export class ChatMessage {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  feedback?: 'helpful' | 'not_helpful';
  feedbackComment?: string;
  metadata?: Record<string, any>;
}

export class ChatFeedback {
  id: string;
  tenantId: string;
  sessionId: string;
  messageId: string;
  rating: 'helpful' | 'not_helpful';
  comment?: string;
  createdAt: Date;
}
