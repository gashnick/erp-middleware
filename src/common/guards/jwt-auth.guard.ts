import { Injectable, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  handleRequest(err: any, user: any, info: any) {
    // You can customize error messages here
    if (err || !user) {
      throw err || new UnauthorizedException('Please log in to access this resource');
    }
    return user;
  }
}
