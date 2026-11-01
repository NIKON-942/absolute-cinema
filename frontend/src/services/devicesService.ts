import { api } from './api';
import type { DevicesDto, HeartbeatResultDto, MessageDto } from '@/types';

export const devicesService = {
  /**
   * Registers/refreshes this device while streaming. Rejects with HTTP 409
   * (code DEVICE_LIMIT) when the plan's concurrent-device limit is reached.
   */
  heartbeat(deviceId: string): Promise<HeartbeatResultDto> {
    return api.post('/devices/heartbeat', { deviceId }).then((r) => r.data);
  },

  list(): Promise<DevicesDto> {
    return api.get('/devices').then((r) => r.data);
  },

  revoke(deviceId: string): Promise<MessageDto | void> {
    return api.delete(`/devices/${encodeURIComponent(deviceId)}`).then((r) => r.data).catch((err) => {
      // 404 → session already gone; treat as success for the UI
      if (err?.response?.status === 404) return undefined;
      throw err;
    });
  },

  /** Best-effort session end — must work during page unload (sendBeacon,
   *  hence everything travels in the query string: no preflightable body). */
  end(deviceId: string): void {
    const token = localStorage.getItem('ac_token');
    if (!token) return;
    const base = import.meta.env.VITE_API_URL || '/api';
    const url = `${base}/devices/end?token=${encodeURIComponent(token)}&deviceId=${encodeURIComponent(deviceId)}`;
    if (navigator.sendBeacon) {
      navigator.sendBeacon(url);
    } else {
      void fetch(url, { method: 'POST', keepalive: true });
    }
  },
};
