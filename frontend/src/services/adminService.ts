import { api } from './api';
import type { AnalyticsDto, MovieDto, Paginated } from '@/types';

export type MovieVisibility = 'all' | 'published' | 'hidden';

export const adminService = {
  movies(filters: { search?: string; page?: number; limit?: number; visibility?: MovieVisibility }): Promise<Paginated<MovieDto>> {
    return api.get('/admin/media', { params: filters }).then((r) => r.data);
  },

  movie(id: number): Promise<MovieDto> {
    return api.get(`/admin/media/${id}`).then((r) => r.data);
  },

  setMovieVisibility(id: number, isHidden: boolean): Promise<MovieDto> {
    return api.patch(`/admin/media/${id}/visibility`, { isHidden }).then((r) => r.data);
  },

  analytics(days = 30): Promise<AnalyticsDto> {
    return api.get('/admin/analytics', { params: { days } }).then((r) => r.data);
  },
};
