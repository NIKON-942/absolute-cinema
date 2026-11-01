import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * JWT guard. The token is taken from the Authorization header or, as a
 * fallback for endpoints that browsers address without headers (the <video>
 * element), from the ?token= query parameter — see JwtStrategy extractor.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
