import type { ServerResponse } from 'node:http';

import { Controller, Get, Res } from '@nestjs/common';

import { HealthService, type Liveness, type Readiness } from './health.service.js';

@Controller()
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get('healthz')
  check(): Liveness {
    return this.health.liveness();
  }

  /**
   * 200 `{"status":"ok"}`, or 503 `{"status":"unavailable"}` when the database cannot be reached. The status is set here rather than
   * thrown, so the body stays this small contract of the probe and does not become a problem+json of the global filter (AR-03).
   */
  @Get('readyz')
  async ready(@Res({ passthrough: true }) res: ServerResponse): Promise<Readiness> {
    const readiness = await this.health.readiness();
    if (readiness.status !== 'ok') res.statusCode = 503;
    return readiness;
  }
}
