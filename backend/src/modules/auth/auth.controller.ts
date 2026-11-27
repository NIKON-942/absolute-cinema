import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { GoogleCallbackGuard } from './google-callback.guard';
import { GoogleFlowService, GoogleRequest } from './google-flow.service';
import { Response, Request } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RateLimit, RateLimitGuard } from '../../common/guards/rate-limit.guard';
import { AuthService } from './auth.service';
import {
  ForgotPasswordDto,
  LoginDto,
  RegisterDto,
  ResetPasswordDto,
} from './dto/auth.dto';

/** Auth endpoints: register, login, Google OAuth, logout, password reset. */
@Controller('auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    private googleFlow: GoogleFlowService,
  ) {}

  /** POST /auth/register - creates an account (limited to 20 per hour per IP). */
  @Post('register')
  @UseGuards(RateLimitGuard)
  @RateLimit({ name: 'register', limit: 20, windowSeconds: 3600 })
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  /** POST /auth/login - returns user data and an access token. */
  @Post('login')
  @UseGuards(RateLimitGuard)
  @RateLimit({ name: 'login', limit: 30, windowSeconds: 300 })
  @HttpCode(200)
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  /** Starts Google sign-in: redirects the browser to Google. */
  @Get('google')
  async googleLogin(@Res() res: Response, @Query('returnTo') returnTo?: string) {
    try { res.redirect(await this.googleFlow.begin(res, returnTo)); }
    catch { res.redirect(this.googleFlow.landing('unavailable')); }
  }

  /** Links a Google account to the already logged in user. */
  @Post('google/link')
  @UseGuards(JwtAuthGuard)
  async googleLink(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return { url: await this.googleFlow.begin(res, '/profile', req.user as { id: number; tokenVersion: number }) };
  }

  /** The frontend swaps the one-time code for the access token. */
  @Post('google/exchange')
  @HttpCode(200)
  googleExchange(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Body() body: { code: string }) {
    return this.googleFlow.exchange(req, res, body?.code);
  }

  /** Google redirects here after login. Result is passed to the frontend by redirect. */
  @Get('google/callback')
  @UseGuards(GoogleCallbackGuard)
  async googleCallback(@Req() req: GoogleRequest, @Res() res: Response) {
    try {
      const token = await this.authService.loginWithGoogle(req.user as Parameters<AuthService['loginWithGoogle']>[0], req.googleFlow?.user_id ?? undefined, req.googleFlow?.token_version ?? undefined);
      res.redirect(await this.googleFlow.finish(req.googleFlow!, token));
    } catch (error) {
      const code = (error as { getResponse?: () => unknown }).getResponse?.() as { code?: string } | undefined;
      res.redirect(this.googleFlow.landing(code?.code === 'GOOGLE_LINK_REQUIRED' ? 'linkRequired' : code?.code === 'GOOGLE_ACCOUNT_CONFLICT' ? 'conflict' : 'failed'));
    }
  }

  /** Current user by the token. */
  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@Req() req: Request) {
    return this.authService.me((req.user as { id: number }).id);
  }

  /** Logout: all tokens of the user become invalid. */
  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  logout(@Req() req: Request) {
    return this.authService.logout((req.user as { id: number }).id);
  }

  /** Short token for the <video> tag, because it can't send headers. */
  @Post('stream-token')
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  streamToken(@Req() req: Request) {
    return this.authService.signStreamToken(req.user as { id: number; email: string; tokenVersion: number });
  }

  /** Sends a reset link (the answer is the same whether the e-mail exists or not). */
  @Post('forgot-password')
  @UseGuards(RateLimitGuard)
  @RateLimit({ name: 'forgot-password', limit: 10, windowSeconds: 3600, perEmail: 3 })
  @HttpCode(200)
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto);
  }

  /** Changes the password using the token from the e-mail. */
  @Post('reset-password')
  @UseGuards(RateLimitGuard)
  @RateLimit({ name: 'reset-password', limit: 20, windowSeconds: 3600 })
  @HttpCode(200)
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }
}
