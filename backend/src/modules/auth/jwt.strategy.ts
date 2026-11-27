import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Request } from 'express';
import { AppConfig } from '../../config/configuration';
import { UsersService } from '../users/users.service';

interface JwtPayload {
  sub: number;
  email: string;
  tv?: number;
  /** 'stream' marks a short-lived token that may only be used in URLs of the playback endpoints. */
  scp?: string;
}

export const STREAM_SCOPE = 'stream';

/** Routes that <video src> / sendBeacon call without being able to set an Authorization header. */
const STREAM_ROUTE = /\/(media\/\d+\/stream|devices\/end)\/?$/;

function isStreamRoute(req: Request): boolean {
  return STREAM_ROUTE.test((req.originalUrl ?? req.url ?? '').split('?')[0]);
}

/** Passport strategy: checks the JWT and loads the user from the database on every request. */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: ConfigService<AppConfig, true>,
    private usersService: UsersService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        ExtractJwt.fromAuthHeaderAsBearerToken(),
        // <video src> requests cannot set headers: ?token= is read, but validate() accepts it
        // only as a stream-scoped token on the playback routes (never the full session token).
        (req: Request) => (typeof req?.query?.token === 'string' ? req.query.token : null),
      ]),
      ignoreExpiration: false,
      secretOrKey: config.get('jwt', { infer: true })!.secret,
      passReqToCallback: true,
    });
  }

  /** Rejects wrong token type, blocked users and tokens revoked by logout. The result becomes req.user. */
  async validate(req: Request, payload: JwtPayload) {
    const viaHeader = !!req.headers?.authorization?.startsWith('Bearer ');
    if (payload.scp === STREAM_SCOPE) {
      if (!isStreamRoute(req)) throw new UnauthorizedException();
    } else if (payload.scp !== undefined || !viaHeader) {
      // A full session token is accepted only in the Authorization header.
      throw new UnauthorizedException();
    }
    const found = await this.usersService.findWithSubscription(payload.sub);
    if (
      !found ||
      found.user.isBlocked ||
      // token revoked by a logout (FR-36)
      found.user.tokenVersion !== (payload.tv ?? 0)
    ) {
      throw new UnauthorizedException();
    }
    // Flat shape: req.user.id / .role / .hasActiveSubscription
    return {
      ...found.user,
      activeSubscription: found.activeSubscription,
      hasActiveSubscription: found.hasActiveSubscription,
    };
  }
}
