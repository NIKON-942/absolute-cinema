import { Controller, Get } from '@nestjs/common';

/** Root health/info endpoint so GET /api returns something useful. */
@Controller()
export class HealthController {
  @Get()
  health() {
    return {
      status: 'ok',
      service: 'absolutecinema-api',
      docs: 'see docs/api-contract.md',
      endpoints: [
        '/api/auth',
        '/api/users',
        '/api/media',
        '/api/recommendations',
        '/api/payments',
        '/api/admin',
      ],
    };
  }
}
