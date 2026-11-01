import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'crypto';
import { Repository } from 'typeorm';
import { AppConfig } from '../../config/configuration';
import { ConfigService } from '@nestjs/config';
import { UserEntity } from '../users/user.entity';
import { UsersService } from '../users/users.service';
import { MailService } from '../mail/mail.service';
import {
  ForgotPasswordDto,
  LoginDto,
  RegisterDto,
  ResetPasswordDto,
} from './dto/auth.dto';

@Injectable()
export class AuthService {
  constructor(
    private jwt: JwtService,
    private config: ConfigService<AppConfig, true>,
    private usersService: UsersService,
    private mail: MailService,
    @InjectRepository(UserEntity)
    private usersRepo: Repository<UserEntity>,
  ) {}

  private signToken(user: UserEntity): string {
    return this.jwt.sign({
      sub: user.id,
      email: user.email,
      tv: user.tokenVersion,
    });
  }

  async register(dto: RegisterDto) {
    const email = dto.email.toLowerCase();
    const existing = await this.usersService.findByEmail(email);
    if (existing) {
      throw new ConflictException('Email is already registered');
    }
    let user: UserEntity;
    try {
      user = await this.usersRepo.save({
        email,
        name: dto.name,
        passwordHash: await bcrypt.hash(dto.password, 10),
      });
    } catch (err: unknown) {
      // Concurrent registration with the same email loses the unique-index
      // race — surface it as 409 instead of an unhandled 500 (Postgres 23505).
      if (
        typeof err === 'object' &&
        err !== null &&
        'code' in err &&
        (err as { code?: string }).code === '23505'
      ) {
        throw new ConflictException('Email is already registered');
      }
      throw err;
    }
    this.mail.sendWelcome(user.email, user.name);
    return {
      user: this.usersService.serialize(
        await this.usersService.attachSubscription(user),
      ),
      accessToken: this.signToken(user),
    };
  }

  async login(dto: LoginDto) {
    const user = await this.usersService.findByEmail(dto.email);
    if (!user || !user.passwordHash) {
      throw new UnauthorizedException('Invalid credentials');
    }
    const ok = await bcrypt.compare(dto.password, user.passwordHash);
    if (!ok) throw new UnauthorizedException('Invalid credentials');
    if (user.isBlocked) throw new ForbiddenException('Account is blocked');
    const lastLoginAt = new Date();
    user.lastLoginAt = lastLoginAt;
    await this.usersRepo.update(user.id, { lastLoginAt });
    return {
      user: this.usersService.serialize(
        await this.usersService.attachSubscription(user),
      ),
      accessToken: this.signToken(user),
    };
  }

  /**
   * Called by the Google OAuth callback with the verified profile.
   * `emailVerified` is asserted by the strategy — auto-linking an existing
   * password account purely on an email match is only safe for verified
   * addresses (otherwise anyone could claim a victim's email).
   */
  async loginWithGoogle(profile: {
    googleId: string;
    email: string;
    name: string;
    avatarUrl?: string;
    emailVerified: boolean;
  }): Promise<string> {
    if (!profile.emailVerified) {
      throw new ForbiddenException(
        'Google account email is not verified — sign up with a password instead',
      );
    }
    let user = await this.usersService.findByEmail(profile.email);
    if (!user) {
      user = await this.usersRepo.save({
        email: profile.email.toLowerCase(),
        name: profile.name,
        googleId: profile.googleId,
        avatarUrl: profile.avatarUrl ?? null,
      });
      this.mail.sendWelcome(user.email, user.name);
    } else {
      // Blocked users must never receive a JWT, regardless of sign-in method.
      if (user.isBlocked) throw new ForbiddenException('Account is blocked');
      if (!user.googleId) {
        user.googleId = profile.googleId;
        await this.usersRepo.update(user.id, {
          googleId: profile.googleId,
          lastLoginAt: new Date(),
          ...(profile.avatarUrl && !user.avatarUrl
            ? { avatarUrl: profile.avatarUrl }
            : {}),
        });
      } else {
        await this.usersRepo.update(user.id, { lastLoginAt: new Date() });
      }
    }
    return this.signToken(user);
  }

  /** FR-36: revokes all tokens issued before now (tokenVersion bump). */
  async logout(userId: number): Promise<{ message: string }> {
    await this.usersRepo.increment({ id: userId }, 'tokenVersion', 1);
    return { message: 'Logged out' };
  }

  async me(userId: number) {
    return this.usersService.serialize(
      await this.usersService.requireWithSubscription(userId),
    );
  }

  async forgotPassword(dto: ForgotPasswordDto) {
    const user = await this.usersService.findByEmail(dto.email);
    // Always respond 200 so the endpoint can't be used to enumerate accounts.
    if (user) {
      const token = randomBytes(32).toString('hex');
      const hash = createHash('sha256').update(token).digest('hex');
      await this.usersRepo.update(user.id, {
        resetTokenHash: hash,
        resetTokenExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      });
      this.mail.sendPasswordReset(
        user.email,
        `${this.config.get('clientUrl', { infer: true })}/reset-password?token=${token}`,
      );
    }
    return { message: 'If the account exists, a reset link has been sent' };
  }

  async resetPassword(dto: ResetPasswordDto) {
    const hash = createHash('sha256').update(dto.token).digest('hex');
    const user = await this.usersRepo.findOne({
      where: { resetTokenHash: hash },
    });
    if (
      !user ||
      !user.resetTokenExpiresAt ||
      user.resetTokenExpiresAt.getTime() < Date.now()
    ) {
      throw new BadRequestException('Reset token is invalid or expired');
    }
    await this.usersRepo.update(user.id, {
      passwordHash: await bcrypt.hash(dto.newPassword, 10),
      resetTokenHash: null,
      resetTokenExpiresAt: null, // single use
    });
    // Invalidate every session/token issued before the reset (FR-36).
    await this.usersRepo.increment({ id: user.id }, 'tokenVersion', 1);
    return { message: 'Password has been updated' };
  }
}
