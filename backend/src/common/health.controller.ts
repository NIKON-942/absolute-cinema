import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { DataSource } from 'typeorm';

/** Root health/info endpoint so GET /api returns something useful. */
@Controller()
export class HealthController {
  constructor(private readonly dataSource: DataSource) {}

  @Get('health/ready')
  async ready() {
    try {
      await this.dataSource.query('SELECT 1');
      return { status: 'ok' };
    } catch {
      throw new ServiceUnavailableException('Database unavailable');
    }
  }

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
