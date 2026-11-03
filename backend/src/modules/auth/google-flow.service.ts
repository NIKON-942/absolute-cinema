import { Injectable, UnauthorizedException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { createHash, randomBytes } from 'crypto';
import { Request, Response } from 'express';
import type { AppConfig } from '../../config/configuration';
import { Interval } from '@nestjs/schedule';

const COOKIE = 'ac_google_flow';
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export function safeReturnTo(value: unknown): string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || /[\\\r\n]/.test(value) || value.length > 2048) return '/';
  try { const url = new URL(value, 'https://app.invalid'); return url.origin === 'https://app.invalid' && !url.pathname.startsWith('/auth/') && !['/login','/register'].includes(url.pathname) ? url.pathname + url.search + url.hash : '/'; } catch { return '/'; }
}
export interface GoogleFlow { state_hash: string; return_to: string; user_id: number | null; token_version: number | null; }
export type GoogleRequest = Request & { googleFlow?: GoogleFlow };

@Injectable()
export class GoogleFlowService {
  constructor(private db: DataSource, private config: ConfigService<AppConfig, true>) {}
  @Interval(60000)
  async cleanup(): Promise<void> {
    await this.db.query('DELETE FROM google_oauth_flows WHERE expires_at < now()').catch(() => undefined);
  }
  private get settings() { return this.config.get('google', { infer: true })!; }
  private get cookieOptions() { return { httpOnly: true, sameSite: 'lax' as const, secure: this.settings.callbackUrl.startsWith('https://'), path: '/api/auth/google', maxAge: 10 * 60 * 1000 }; }
  browser(req: Request): string {
    const cookie = req.headers.cookie?.split(';').map(s => s.trim()).find(s => s.startsWith(COOKIE + '='))?.slice(COOKIE.length + 1);
    if (!cookie || !/^[a-f0-9]{64}$/.test(cookie)) throw new UnauthorizedException('Invalid Google browser binding');
    return hash(cookie);
  }
  async begin(res: Response, returnTo: unknown, user?: { id: number; tokenVersion: number }): Promise<string> {
    if (!this.settings.clientId || !this.settings.clientSecret) throw new ServiceUnavailableException('Google sign-in is not configured');
    const state = randomBytes(32).toString('hex'); const browser = randomBytes(32).toString('hex');
    await this.db.query('DELETE FROM google_oauth_flows WHERE expires_at < now()');
    await this.db.query(`INSERT INTO google_oauth_flows (state_hash, browser_hash, return_to, user_id, token_version, expires_at)
      VALUES ($1, $2, $3, $4, $5, now() + interval '10 minutes')`, [hash(state), hash(browser), user ? '/profile' : safeReturnTo(returnTo), user?.id ?? null, user?.tokenVersion ?? null]);
    res.cookie(COOKIE, browser, this.cookieOptions); res.setHeader('Cache-Control', 'no-store');
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.search = new URLSearchParams({ client_id: this.settings.clientId, redirect_uri: this.settings.callbackUrl, response_type: 'code', scope: 'openid email profile', state, prompt: 'select_account' }).toString();
    return url.href;
  }
  async consume(req: Request): Promise<GoogleFlow> {
    const state = req.query.state;
    if (typeof state !== 'string' || !/^[a-f0-9]{64}$/.test(state)) throw new UnauthorizedException('Invalid Google state');
    const [flow] = await this.db.query(`WITH consumed AS (UPDATE google_oauth_flows SET state_used = true WHERE state_hash = $1 AND browser_hash = $2 AND state_used = false AND expires_at > now() RETURNING *) SELECT * FROM consumed`, [hash(state), this.browser(req)]);
    if (!flow) throw new UnauthorizedException('Expired or reused Google state');
    return flow;
  }
  async finish(flow: GoogleFlow, token: string): Promise<string> {
    const code = randomBytes(32).toString('hex');
    const rows = await this.db.query(`WITH completed AS (UPDATE google_oauth_flows SET code_hash = $2, access_token = $3, expires_at = now() + interval '1 minute' WHERE state_hash = $1 AND state_used = true AND code_hash IS NULL AND expires_at > now() RETURNING state_hash) SELECT * FROM completed`, [flow.state_hash, hash(code), token]);
    if (!rows.length) throw new UnauthorizedException('Google flow expired or already completed');
    return this.landing() + '#code=' + code;
  }
  async exchange(req: Request, res: Response, code: unknown) {
    if (typeof code !== 'string' || !/^[a-f0-9]{64}$/.test(code)) throw new UnauthorizedException('Invalid Google exchange code');
    const [flow] = await this.db.query(`WITH exchanged AS (DELETE FROM google_oauth_flows WHERE code_hash = $1 AND browser_hash = $2 AND expires_at > now() RETURNING access_token, return_to) SELECT * FROM exchanged`, [hash(code), this.browser(req)]);
    if (!flow?.access_token) throw new UnauthorizedException('Expired or reused Google exchange code');
    res.clearCookie(COOKIE, this.cookieOptions); res.setHeader('Cache-Control', 'no-store');
    return { accessToken: flow.access_token, returnTo: flow.return_to };
  }
  landing(error?: string) {
    const origin = new URL(this.config.get('clientUrl', { infer: true })).origin;
    return origin + '/auth/oauth-success' + (error ? '?error=' + encodeURIComponent(error) : '');
  }
}
