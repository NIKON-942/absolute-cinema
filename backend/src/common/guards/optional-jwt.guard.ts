import { ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * JWT guard that lets requests without a token through (req.user stays
 * undefined). Used by endpoints that personalize when a token is present
 * but also serve guests (recommendations fallback, movie detail).
 * A token that IS presented but invalid/expired still yields 401 so
 * clients can tell "bad token" apart from "no token".
 */
@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest();
    const hasToken =
      req.headers?.authorization?.startsWith('Bearer ') || req.query?.token;
    if (!hasToken) return true;
    return super.canActivate(context);
  }

  handleRequest<TUser = any>(err: unknown, user: unknown): TUser {
    if (err || !user) {
      throw new UnauthorizedException('Invalid or expired token');
    }
    return user as TUser;
  }
}
