import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class GoogleOAuthGuard extends AuthGuard('google') {}

@Injectable()
export class GithubOAuthGuard extends AuthGuard('github') {}
