import { api } from './api';
import type { CheckoutResponseDto, MessageDto, PaymentCompletedDto, PlanDto, SubscriptionPeriod, SubscriptionTier, SwitchPreviewDto } from '@/types';

export interface CancelledCheckoutDto extends MessageDto {
  status: 'pending' | 'paid' | 'failed' | 'cancelled';
  cancellationReason: 'expired' | 'user_cancelled' | 'superseded' | null;
  canRetry: boolean;
}

// requests to /payments
export const paymentsService = {
  cancel(sessionId: string): Promise<CancelledCheckoutDto> {
    return api.post(`/payments/cancel/${sessionId}`).then(r => r.data);
  },
  retry(sessionId: string): Promise<CheckoutResponseDto> {
    return api.post(`/payments/retry/${sessionId}`).then(r => r.data);
  },
  plans(): Promise<PlanDto[]> {
    return api.get('/payments/plans').then((r) => r.data);
  },

  checkout(tier: SubscriptionTier, period: SubscriptionPeriod): Promise<CheckoutResponseDto> {
    return api.post('/payments/checkout', { tier, period }).then((r) => r.data);
  },

  switchPreview(tier: SubscriptionTier, period: SubscriptionPeriod): Promise<SwitchPreviewDto> {
    return api.get('/payments/switch-preview', { params: { tier, period } }).then((r) => r.data);
  },

  mockComplete(sessionId: string): Promise<PaymentCompletedDto> {
    return api.post(`/payments/mock-complete/${sessionId}`).then((r) => r.data);
  },

  cancelSubscription(): Promise<MessageDto> {
    return api.post('/payments/subscription/cancel').then((r) => r.data);
  },

  mockCancel(sessionId: string): Promise<MessageDto> {
    return api.post(`/payments/mock-cancel/${sessionId}`).then((r) => r.data);
  },
};
