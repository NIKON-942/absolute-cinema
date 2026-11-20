import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';

export interface RateLimitOptions {
  /** Bucket name; buckets of different routes are independent. */
  name: string;
  /** Maximum requests per client IP within the window. */
  limit: number;
  windowSeconds: number;
  /** Optional extra limit per `body.email` (protects one mailbox from being flooded from many IPs). */
  perEmail?: number;
}

const KEY = 'rate-limit';
export const RateLimit = (options: RateLimitOptions) => SetMetadata(KEY, options);

interface Bucket { count: number; resetAt: number }

/**
 * Fixed-window in-memory limiter. State lives in one process, which matches the
 * single-instance deployment of this project; use a shared store (Redis) to scale out.
 * Client IP comes from req.ip, so `trust proxy` must be configured behind a reverse proxy.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly buckets = new Map<string, Bucket>();
  private lastSweep = Date.now();

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const options = this.reflector.get<RateLimitOptions | undefined>(KEY, context.getHandler());
    if (!options) return true;
    const req = context.switchToHttp().getRequest<Request>();
    const windowMs = options.windowSeconds * 1000;
    const now = Date.now();
    this.sweep(now);
    const retryAfter = Math.max(
      this.hit(`${options.name}|ip|${req.ip ?? 'unknown'}`, options.limit, windowMs, now),
      options.perEmail ? this.hitEmail(options, req, windowMs, now) : 0,
    );
    if (retryAfter > 0) {
      const res = context.switchToHttp().getResponse<{ setHeader(name: string, value: string): void }>();
      res.setHeader('Retry-After', String(retryAfter));
      throw new HttpException('Too many requests, try again later', HttpStatus.TOO_MANY_REQUESTS);
    }
    return true;
  }

  private hitEmail(options: RateLimitOptions, req: Request, windowMs: number, now: number): number {
    const email = (req.body as { email?: unknown } | undefined)?.email;
    if (typeof email !== 'string' || !email) return 0;
    return this.hit(`${options.name}|email|${email.trim().toLowerCase().slice(0, 254)}`, options.perEmail!, windowMs, now);
  }

  /** Returns 0 when allowed, otherwise the seconds until the window resets. */
  private hit(key: string, limit: number, windowMs: number, now: number): number {
    let bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      this.buckets.set(key, bucket);
    }
    bucket.count += 1;
    return bucket.count > limit ? Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)) : 0;
  }

  private sweep(now: number) {
    if (now - this.lastSweep < 60_000 && this.buckets.size < 50_000) return;
    this.lastSweep = now;
    for (const [key, bucket] of this.buckets) if (bucket.resetAt <= now) this.buckets.delete(key);
  }
}
