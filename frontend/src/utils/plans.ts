import type { Quality, SubscriptionTier } from '@/types';

/** Quality ladder, low → high. */
export const QUALITY_ORDER: Quality[] = ['480p', '720p', '1080p'];

export function qualityRank(q: Quality): number {
  return QUALITY_ORDER.indexOf(q);
}

/**
 * Client-side mirror of subscription_plans (max_devices / max_quality) used
 * to render plan gating before the backend is ever asked; the backend
 * re-validates every stream request, so this only drives the UI.
 */
export const PLAN_LIMITS: Record<SubscriptionTier, { maxDevices: number; maxQuality: Quality }> = {
  basic: { maxDevices: 1, maxQuality: '720p' },
  plus: { maxDevices: 2, maxQuality: '1080p' },
  premium: { maxDevices: 4, maxQuality: '1080p' },
};

/** Limits of the user's active tier (Basic caps when nothing is active). */
export function limitsForTier(tier?: string | null): { maxDevices: number; maxQuality: Quality } {
  if (tier === 'plus' || tier === 'premium') return PLAN_LIMITS[tier];
  return PLAN_LIMITS.basic;
}

const DEVICE_KEY = 'ac_device_id';

/** Stable per-browser device id used for concurrent-device enforcement. */
export function getDeviceId(): string {
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `dev-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}
