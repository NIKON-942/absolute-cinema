import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Req,
  UseGuards,
  RawBodyRequest,
} from '@nestjs/common';
import { Request } from 'express';
import { IsIn } from 'class-validator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import {
  SubscriptionPeriodEnum,
  SubscriptionTierEnum,
} from '../users/user.entity';
import { PaymentsService } from './payments.service';

class CheckoutDto {
  @IsIn(['basic', 'plus', 'premium'])
  tier!: 'basic' | 'plus' | 'premium';

  @IsIn(['monthly', 'yearly'])
  period!: 'monthly' | 'yearly';
}

@Controller('payments')
export class PaymentsController {
  constructor(private paymentsService: PaymentsService) {}

  @Get('plans')
  plans() {
    return this.paymentsService.plans();
  }

  @Post('checkout')
  @UseGuards(JwtAuthGuard)
  checkout(@Req() req: Request, @Body() dto: CheckoutDto) {
    return this.paymentsService.createCheckout(
      (req.user as { id: number }).id,
      dto.tier as SubscriptionTierEnum,
      dto.period as SubscriptionPeriodEnum,
    );
  }

  @Post('mock-complete/:sessionId')
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  mockComplete(@Req() req: Request, @Param('sessionId') sessionId: string) {
    this.paymentsService.assertMockMode();
    // Ownership check inside complete() — a leaked sessionId must not let
    // one user complete another user's order.
    return this.paymentsService.complete(
      sessionId,
      (req.user as { id: number }).id,
    );
  }

  @Post('mock-cancel/:sessionId')
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  mockCancel(@Req() req: Request, @Param('sessionId') sessionId: string) {
    this.paymentsService.assertMockMode();
    return this.paymentsService.cancel(
      sessionId,
      (req.user as { id: number }).id,
    );
  }

  @Post('subscription/cancel')
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  cancelSubscription(@Req() req: Request) {
    return this.paymentsService.cancelSubscription(
      (req.user as { id: number }).id,
    );
  }

  @Post('webhook')
  @HttpCode(200)
  webhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature?: string,
  ) {
    return this.paymentsService.handleWebhook(req.rawBody, signature);
  }
}
