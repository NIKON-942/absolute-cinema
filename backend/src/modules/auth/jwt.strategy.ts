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
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: ConfigService<AppConfig, true>,
    private usersService: UsersService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        ExtractJwt.fromAuthHeaderAsBearerToken(),
        // <video src> requests cannot set headers — accept ?token= as well
        (req: Request) => req?.query?.token as string | null,
      ]),
      ignoreExpiration: false,
      secretOrKey: config.get('jwt', { infer: true })!.secret,
    });
  }

  async validate(payload: JwtPayload) {
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
