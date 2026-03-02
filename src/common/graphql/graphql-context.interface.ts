export interface GraphQLContext {
  req: {
    user: {
      id: string;
      tenantId: string;
      role: string; // populated by JwtStrategy from JWT payload
      email: string;
      schemaName: string; // Optional: populated by JwtStrategy if available in JWT
    };
    ip: string;
    headers: Record<string, string | string[] | undefined>;
  };
}
