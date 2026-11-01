import { api } from './api';
import type { AnalyticsDto } from '@/types';

export const adminService = {
  analytics(days = 30): Promise<AnalyticsDto> {
    return api.get('/admin/analytics', { params: { days } }).then((r) => r.data);
  },
};
