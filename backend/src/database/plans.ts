import { SubscriptionTierEnum } from '../modules/users/user.entity';

export const PLANS: Array<{
  tier: SubscriptionTierEnum;
  monthlyPrice: string;
  yearlyPrice: string;
  maxDevices: number;
  maxQuality: '480p' | '720p' | '1080p';
  prioritySupport?: boolean;
}> = [
  {
    tier: SubscriptionTierEnum.BASIC,
    monthlyPrice: '4.99',
    yearlyPrice: '49.99',
    maxDevices: 1,
    maxQuality: '720p',
  },
  {
    tier: SubscriptionTierEnum.PLUS,
    monthlyPrice: '9.99',
    yearlyPrice: '99.99',
    maxDevices: 2,
    maxQuality: '1080p',
  },
  {
    tier: SubscriptionTierEnum.PREMIUM,
    monthlyPrice: '14.99',
    yearlyPrice: '149.99',
    maxDevices: 4,
    maxQuality: '1080p',
    prioritySupport: true,
  },
];

