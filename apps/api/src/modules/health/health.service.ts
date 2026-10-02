import { Injectable } from '@nestjs/common';

export interface Liveness {
  status: 'ok';
}

@Injectable()
export class HealthService {
  /** Liveness only: the process is up. Readiness (DB, Redis) comes with `/readyz` in PR3. */
  liveness(): Liveness {
    return { status: 'ok' };
  }
}
