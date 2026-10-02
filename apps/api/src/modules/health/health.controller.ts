import { Controller, Get } from '@nestjs/common';

import { HealthService, type Liveness } from './health.service.js';

@Controller()
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get('healthz')
  check(): Liveness {
    return this.health.liveness();
  }
}
