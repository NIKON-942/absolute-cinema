import { SetMetadata } from '@nestjs/common';

export type UserRole = 'viewer' | 'admin' | 'head_admin';

export const ROLES_KEY = 'roles';
// @Roles('admin') marks a route for RolesGuard
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
