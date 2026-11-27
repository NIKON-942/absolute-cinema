import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Query,
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

// body for starting a purchase
class CheckoutDto {
  @IsIn(['basic', 'plus', 'premium'])
  tier!: 'basic' | 'plus' | 'premium';

  @IsIn(['monthly', 'yearly'])
  period!: 'monthly' | 'yearly';
}

class SwitchPreviewQuery {
  @IsIn(['basic', 'plus', 'premium'])
  tier!: 'basic' | 'plus' | 'premium';

  @IsIn(['monthly', 'yearly'])
  period!: 'monthly' | 'yearly';
}

/** Payment endpoints: plans, checkout, cancel, Stripe webhook. */
@Controller('payments')
export class PaymentsController {
  constructor(private paymentsService: PaymentsService) {}

  /** Public list of plans. */
  @Get('plans')
  plans() {
    return this.paymentsService.plans();
  }

  /** Refund and price preview shown before the user confirms a plan switch. */
  @Get('switch-preview')
  @UseGuards(JwtAuthGuard)
  switchPreview(@Req() req: Request, @Query() query: SwitchPreviewQuery) {
    return this.paymentsService.switchPreview(
      (req.user as { id: number }).id,
      query.tier as SubscriptionTierEnum,
      query.period as SubscriptionPeriodEnum,
    );
  }

  /** Creates an order and returns the URL where the user pays. */
  @Post('checkout')
  @UseGuards(JwtAuthGuard)
  checkout(@Req() req: Request, @Body() dto: CheckoutDto) {
    return this.paymentsService.createCheckout(
      (req.user as { id: number }).id,
      dto.tier as SubscriptionTierEnum,
      dto.period as SubscriptionPeriodEnum,
    );
  }

  /** Fake payment success, for demo without Stripe. */
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

  /** Fake payment cancel, for demo without Stripe. */
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

  /** Stops auto renewal of the current subscription. */
  @Post('subscription/cancel')
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  cancelSubscription(@Req() req: Request) {
    return this.paymentsService.cancelSubscription(
      (req.user as { id: number }).id,
    );
  }

  /** Try to pay again for a failed order. */
  @Post('retry/:sessionId')
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  retry(@Req() req: Request, @Param('sessionId') sessionId: string) {
    return this.paymentsService.retry((req.user as { id: number }).id, sessionId);
  }

  /** Cancel a pending order. */
  @Post('cancel/:sessionId')
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  cancel(@Req() req: Request, @Param('sessionId') sessionId: string) {
    return this.paymentsService.cancel(sessionId, (req.user as { id: number }).id);
  }

  /** Stripe calls this URL. Raw body is needed to check the signature. */
  @Post('webhook')
  @HttpCode(200)
  webhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature?: string,
  ) {
    return this.paymentsService.handleWebhook(req.rawBody, signature);
  }
}
