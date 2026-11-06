import { api } from './api';
import type { CheckoutResponseDto, MessageDto, PlanDto, SubscriptionPeriod, SubscriptionTier } from '@/types';

export interface CancelledCheckoutDto extends MessageDto {
  status: 'pending' | 'paid' | 'failed' | 'cancelled';
  cancellationReason: 'expired' | 'user_cancelled' | 'superseded' | null;
  canRetry: boolean;
}

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

  mockComplete(sessionId: string): Promise<MessageDto> {
    return api.post(`/payments/mock-complete/${sessionId}`).then((r) => r.data);
  },

  cancelSubscription(): Promise<MessageDto> {
    return api.post('/payments/subscription/cancel').then((r) => r.data);
  },

  mockCancel(sessionId: string): Promise<MessageDto> {
    return api.post(`/payments/mock-cancel/${sessionId}`).then((r) => r.data);
  },
};
