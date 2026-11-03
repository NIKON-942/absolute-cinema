import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Response } from 'express';
import { GoogleFlowService, GoogleRequest } from './google-flow.service';
@Injectable()
export class GoogleCallbackGuard extends AuthGuard('google') {
  constructor(private flow: GoogleFlowService) { super(); }
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<GoogleRequest>();
    const res = context.switchToHttp().getResponse<Response>();
    res.setHeader('Cache-Control', 'no-store');
    try { req.googleFlow = await this.flow.consume(req); }
    catch { res.redirect(this.flow.landing('state')); return false; }
    if (req.query.error) { res.redirect(this.flow.landing(req.query.error === 'access_denied' ? 'cancelled' : 'failed')); return false; }
    if (typeof req.query.code !== 'string' || !req.query.code) { res.redirect(this.flow.landing('failed')); return false; }
    try { return await super.canActivate(context) as boolean; }
    catch { res.redirect(this.flow.landing('failed')); return false; }
  }
}
