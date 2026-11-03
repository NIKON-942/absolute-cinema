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
import { AuthService } from './auth.service';
import {
  ForgotPasswordDto,
  LoginDto,
  RegisterDto,
  ResetPasswordDto,
} from './dto/auth.dto';

@Controller('auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    private googleFlow: GoogleFlowService,
  ) {}

  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('login')
  @HttpCode(200)
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Get('google')
  async googleLogin(@Res() res: Response, @Query('returnTo') returnTo?: string) {
    try { res.redirect(await this.googleFlow.begin(res, returnTo)); }
    catch { res.redirect(this.googleFlow.landing('unavailable')); }
  }

  @Post('google/link')
  @UseGuards(JwtAuthGuard)
  async googleLink(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return { url: await this.googleFlow.begin(res, '/profile', req.user as { id: number; tokenVersion: number }) };
  }

  @Post('google/exchange')
  @HttpCode(200)
  googleExchange(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Body() body: { code: string }) {
    return this.googleFlow.exchange(req, res, body?.code);
  }

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

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@Req() req: Request) {
    return this.authService.me((req.user as { id: number }).id);
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  logout(@Req() req: Request) {
    return this.authService.logout((req.user as { id: number }).id);
  }

  @Post('forgot-password')
  @HttpCode(200)
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto);
  }

  @Post('reset-password')
  @HttpCode(200)
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }
}
