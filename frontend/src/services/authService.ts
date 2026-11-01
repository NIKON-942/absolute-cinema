import { api } from './api';
import type { AuthResponseDto, MessageDto, UserDto } from '@/types';

export interface RegisterPayload {
  email: string;
  password: string;
  name: string;
}

export const authService = {
  register(payload: RegisterPayload): Promise<AuthResponseDto> {
    return api.post('/auth/register', payload).then((r) => r.data);
  },

  login(email: string, password: string): Promise<AuthResponseDto> {
    return api.post('/auth/login', { email, password }).then((r) => r.data);
  },

  me(): Promise<UserDto> {
    return api.get('/auth/me').then((r) => r.data);
  },

  /** Server-side token revocation (FR-36). */
  logout(): Promise<MessageDto> {
    return api.post('/auth/logout').then((r) => r.data);
  },

  forgotPassword(email: string): Promise<MessageDto> {
    return api.post('/auth/forgot-password', { email }).then((r) => r.data);
  },

  resetPassword(token: string, newPassword: string): Promise<MessageDto> {
    return api.post('/auth/reset-password', { token, newPassword }).then((r) => r.data);
  },
};
