import { Request } from 'express';

/** The JWT guard guarantees req.user on protected routes; narrow it safely. */
export function currentUser(req: Request): { id: number } {
  return req.user as { id: number };
}

export function currentUserId(req: Request): number {
  return (req.user as { id: number }).id;
}
