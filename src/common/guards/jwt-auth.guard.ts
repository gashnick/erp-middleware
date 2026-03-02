import { Injectable, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { GqlExecutionContext } from '@nestjs/graphql';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  /**
   * Overriding getRequest is essential for GraphQL support.
   * This ensures Passport can find the 'req' object to perform authentication.
   */
  getRequest(context: ExecutionContext) {
    // Check if the request is coming through GraphQL
    if (context.getType<string>() === 'graphql') {
      const ctx = GqlExecutionContext.create(context);
      return ctx.getContext().req;
    }

    // Fallback for REST requests
    return context.switchToHttp().getRequest();
  }

  handleRequest(err: any, user: any, info: any) {
    if (err || !user) {
      // You can log 'info' here to see why the JWT failed (e.g., expired, invalid signature)
      throw err || new UnauthorizedException('Please log in to access this resource');
    }
    return user;
  }
}
