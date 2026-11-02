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
    file?: File | null;
  }): Promise<UserDto> {
    if (payload.file) {
      const form = new FormData();
      form.append('file', payload.file);
      for (const [key, value] of Object.entries(payload)) {
        if (key !== 'file' && value !== undefined) form.append(key, value === null ? '' : String(value));
      }
      return api.patch('/users/me', form, { headers: { 'Content-Type': 'multipart/form-data' } }).then(r => r.data);
    }
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
