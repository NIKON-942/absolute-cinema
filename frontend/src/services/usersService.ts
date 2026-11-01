import { api } from './api';
import type { Paginated, Role, UserDto } from '@/types';

export const usersService = {
  list(params: { page?: number; limit?: number; search?: string }): Promise<Paginated<UserDto>> {
    return api.get('/users', { params }).then((r) => r.data);
  },

  me(): Promise<UserDto> {
    return api.get('/users/me').then((r) => r.data);
  },

  updateMe(payload: {
    name?: string;
    password?: string;
    currentPassword?: string;
    avatarUrl?: string | null;
  }): Promise<UserDto> {
    return api.patch('/users/me', payload).then((r) => r.data);
  },

  changeRole(id: number, role: Role): Promise<UserDto> {
    return api.patch(`/users/${id}/role`, { role }).then((r) => r.data);
  },

  setBlocked(id: number, isBlocked: boolean): Promise<UserDto> {
    return api.patch(`/users/${id}/block`, { isBlocked }).then((r) => r.data);
  },

  remove(id: number): Promise<void> {
    return api.delete(`/users/${id}`).then(() => undefined);
  },
};
