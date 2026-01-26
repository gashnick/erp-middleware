import { Role } from '@auth/enums/role.enum';
import { Request } from 'express';

export interface AuthenticatedRequest extends Request {
  user: {
    id: string; // Matches your 'id: payload.sub' from the strategy
    email: string;
    role: Role;
    tenantId: string; // Essential for the multi-tenant routing
    schemaName?: string; // Optional: Useful if you attach the schema name later
  };
}
