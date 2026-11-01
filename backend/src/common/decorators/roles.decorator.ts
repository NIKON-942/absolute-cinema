import { SetMetadata } from '@nestjs/common';

export type UserRole = 'viewer' | 'admin';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
