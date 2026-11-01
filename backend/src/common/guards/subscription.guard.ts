import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';

/**
 * Allows the request through only when the authenticated user has an
 * active subscription (any tier). Requires JwtAuthGuard to run first so
 * req.user is populated.
 */
@Injectable()
export class SubscriptionGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const { user } = context.switchToHttp().getRequest();
    if (!user?.hasActiveSubscription) {
      throw new ForbiddenException('Active subscription required');
    }
    return true;
  }
}
