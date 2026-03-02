import { Injectable, NotFoundException } from '@nestjs/common';
import { TenantQueryRunnerService } from '@database/tenant-query-runner.service';
import { ChatSession, ChatMessage, MessageRole, MessageContent } from './chat.types';

@Injectable()
export class ChatSessionRepository {
  // 1. Target local schema (no 'public.' prefix)
  // 2. Remove 'tenant_id' column entirely
  private static readonly CREATE_SESSION_SQL = `
    INSERT INTO chat_sessions (user_id)
    VALUES ($1)
    RETURNING id, user_id AS "userId", created_at AS "createdAt"
  `;

  private static readonly GET_SESSION_SQL = `
    SELECT id, user_id AS "userId", created_at AS "createdAt"
    FROM chat_sessions WHERE id = $1
  `;

  private static readonly INSERT_MESSAGE_SQL = `
    INSERT INTO chat_messages (session_id, role, content, latency_ms)
    VALUES ($1, $2, $3::jsonb, $4)
    RETURNING id, session_id AS "sessionId", role, content,
              latency_ms AS "latencyMs", created_at AS "createdAt"
  `;

  private static readonly GET_MESSAGES_SQL = `
    SELECT id, session_id AS "sessionId", role, content,
           latency_ms AS "latencyMs", created_at AS "createdAt"
    FROM chat_messages WHERE session_id = $1 ORDER BY created_at ASC
  `;

  constructor(private readonly tenantDb: TenantQueryRunnerService) {}

  async createSession(userId: string): Promise<ChatSession> {
    // transaction() triggers the schema switch in your TenantQueryRunnerService
    return this.tenantDb.transaction(async (runner) => {
      const rows = await runner.query(ChatSessionRepository.CREATE_SESSION_SQL, [userId]);
      return { ...rows[0], messages: [] };
    });
  }

  async getSession(sessionId: string): Promise<ChatSession> {
    return this.tenantDb.transaction(async (runner) => {
      const sessions = await runner.query(ChatSessionRepository.GET_SESSION_SQL, [sessionId]);

      if (!sessions[0]) {
        throw new NotFoundException(`ChatSession ${sessionId} not found.`);
      }

      const messages = await runner.query(ChatSessionRepository.GET_MESSAGES_SQL, [sessionId]);

      return { ...sessions[0], messages };
    });
  }

  async saveMessage(msg: {
    sessionId: string;
    role: MessageRole;
    content: MessageContent;
    latencyMs?: number;
  }): Promise<ChatMessage> {
    return this.tenantDb.transaction(async (runner) => {
      const rows = await runner.query(ChatSessionRepository.INSERT_MESSAGE_SQL, [
        msg.sessionId,
        msg.role,
        JSON.stringify(msg.content),
        msg.latencyMs ?? null,
      ]);
      return rows[0];
    });
  }
}
