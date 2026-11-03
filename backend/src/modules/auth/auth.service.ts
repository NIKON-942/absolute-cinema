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
    // Return failures from the transaction so the counter commits before the
    // HTTP error is thrown. A row lock serializes concurrent login attempts.
    const result = await this.usersRepo.manager.transaction(async em => {
      const repo = em.getRepository(UserEntity);
      const user = await repo.findOne({ where: { email: dto.email.toLowerCase() }, lock: { mode: 'pessimistic_write' } });
      if (!user || !user.passwordHash) return { error: 'invalid' } as const;
      if (user.isBlocked) return { error: 'blocked' } as const;
      if (user.loginLockedUntil && user.loginLockedUntil.getTime() > Date.now()) return { error: 'locked' } as const;
      if (user.loginLockedUntil) user.failedLoginAttempts = 0;
      if (!await bcrypt.compare(dto.password, user.passwordHash)) {
        const attempts = (user.failedLoginAttempts ?? 0) + 1;
        await repo.update(user.id, { failedLoginAttempts: attempts,
          loginLockedUntil: attempts >= 5 ? new Date(Date.now() + 60 * 60 * 1000) : null });
        return { error: attempts >= 5 ? 'locked' : 'invalid' } as const;
      }
      user.lastLoginAt = new Date();
      await repo.update(user.id, { lastLoginAt: user.lastLoginAt, failedLoginAttempts: 0, loginLockedUntil: null });
      return { user };
    });
    if (!result.user) {
      if (result.error === 'blocked') throw new ForbiddenException('Account is blocked');
      if (result.error === 'locked') throw new ForbiddenException('Sign-in locked for one hour after five failed attempts');
      throw new UnauthorizedException('Invalid credentials');
    }
    const user = result.user;
    return {
      user: this.usersService.serialize(
        await this.usersService.attachSubscription(user),
      ),
      accessToken: this.signToken(user),
    };
  }

  /** Google ID is authoritative. Existing password accounts require an explicit signed-in link. */
  async loginWithGoogle(profile: {
    googleId: string; email: string; name: string; avatarUrl?: string; emailVerified: boolean;
  }, linkUserId?: number, expectedTokenVersion?: number): Promise<string> {
    if (!profile.emailVerified || !profile.googleId || !profile.email) throw new ForbiddenException('Google account has no verified email');
    const conflict = () => new ConflictException({ code: 'GOOGLE_ACCOUNT_CONFLICT', message: 'This Google account is already linked to another account' });
    let created = false;
    let user: UserEntity;
    try {
      user = await this.usersRepo.manager.transaction(async em => {
        await em.query('SELECT pg_advisory_xact_lock(1703, hashtext($1))', [profile.googleId]);
        const owner = await em.findOneBy(UserEntity, { googleId: profile.googleId });
        let target: UserEntity;
        if (linkUserId !== undefined) {
          const current = await em.findOne(UserEntity, { where: { id: linkUserId }, lock: { mode: 'pessimistic_write' } });
          if (!current || current.isBlocked || current.tokenVersion !== expectedTokenVersion) throw new ForbiddenException('The linking session has expired');
          if ((owner && owner.id !== current.id) || (current.googleId && current.googleId !== profile.googleId)) throw conflict();
          current.googleId = profile.googleId; target = current;
        } else if (owner) {
          const current = await em.findOneOrFail(UserEntity, { where: { id: owner.id }, lock: { mode: 'pessimistic_write' } });
          target = current;
        } else {
          const existing = await em.findOneBy(UserEntity, { email: profile.email.trim().toLowerCase() });
          if (existing) throw new ConflictException({ code: 'GOOGLE_LINK_REQUIRED', message: 'Sign in with your password, then link Google in your profile' });
          target = em.create(UserEntity, { email: profile.email.trim().toLowerCase(), name: profile.name?.trim().slice(0,255) || 'Google User', googleId: profile.googleId });
          created = true;
        }
        if (target.isBlocked) throw new ForbiddenException('Account is blocked');
        target.lastLoginAt = new Date();
        if (!target.avatarUrl && profile.avatarUrl) target.avatarUrl = profile.avatarUrl;
        return em.save(target);
      });
    } catch (error) {
      if ((error as { code?: string }).code === '23505') throw conflict();
      throw error;
    }
    if (created) this.mail.sendWelcome(user.email, user.name);
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
    const passwordHash = await bcrypt.hash(dto.newPassword, 10);
    // Consume the token and revoke sessions in one conditional statement.
    const result = await this.usersRepo.createQueryBuilder().update().set({
      passwordHash,
      resetTokenHash: null,
      resetTokenExpiresAt: null,
      tokenVersion: () => 'token_version + 1',
      failedLoginAttempts: 0,
      loginLockedUntil: null,
    }).where('reset_token_hash = :hash AND reset_token_expires_at > CURRENT_TIMESTAMP', { hash }).execute();
    if (!result.affected) {
      throw new BadRequestException('Reset token is invalid or expired');
    }
    return { message: 'Password has been updated' };
  }
}
