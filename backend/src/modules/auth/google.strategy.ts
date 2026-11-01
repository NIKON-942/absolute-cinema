import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, VerifyCallback } from 'passport-google-oauth20';
import { AppConfig } from '../../config/configuration';

/**
 * Registered only when GOOGLE_CLIENT_ID is configured — the app boots
 * fine without it (Google login then returns a helpful error).
 */
@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(config: ConfigService<AppConfig, true>) {
    super({
      clientID: config.get('google', { infer: true })!.clientId,
      clientSecret: config.get('google', { infer: true })!.clientSecret,
      callbackURL: config.get('google', { infer: true })!.callbackUrl,
      scope: ['email', 'profile'],
    });
  }

  validate(
    _accessToken: string,
    _refreshToken: string,
    profile: {
      emails?: { value: string; verified?: boolean }[];
      displayName?: string;
      photos?: { value: string }[];
      id: string;
    },
    done: VerifyCallback,
  ): void {
    // Only verified addresses may be used — an unverified email would let
    // anyone claim an existing account by creating a Google profile with it.
    const verifiedEmail = profile.emails?.find((e) => e.verified === true);
    if (!verifiedEmail) {
      done(
        new Error('Google account has no verified email — cannot sign in'),
        false,
      );
      return;
    }
    const user = {
      googleId: profile.id,
      email: verifiedEmail.value,
      name: profile.displayName ?? 'Google User',
      avatarUrl: profile.photos?.[0]?.value,
      emailVerified: true,
    };
    done(null, user);
  }
}
