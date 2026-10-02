import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';

import { HealthService, type Liveness, type Readiness } from './health.service.js';

@Controller()
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get('healthz')
  check(): Liveness {
    return this.health.liveness();
  }

  /** 200 `{"status":"ok"}`, or 503 `{"status":"unavailable"}` when the database cannot be reached. */
  @Get('readyz')
  async ready(): Promise<Readiness> {
    const readiness = await this.health.readiness();
    if (readiness.status !== 'ok') throw new ServiceUnavailableException(readiness);
    return readiness;
  }
}
