import { Injectable } from '@nestjs/common';

import { AuthService } from '../auth/auth.service.js';
import { DatabaseService } from '../database/database.service.js';

export interface Liveness {
  status: 'ok';
}

/** Deliberately only two states: the reason a dependency is down stays out of the response. */
export interface Readiness {
  status: 'ok' | 'unavailable';
}

@Injectable()
export class HealthService {
  constructor(
    private readonly database: DatabaseService,
    private readonly authService: AuthService,
  ) {}

  /** Liveness: the process is up. Never touches a dependency. */
  liveness(): Liveness {
    return { status: 'ok' };
  }

  /** Readiness: can the API reach its databases, the one of the application and the one of sign-in? (Valkey joins with BullMQ, N52.) */
  async readiness(): Promise<Readiness> {
    const reachable = await Promise.all([this.database.ping(), this.authService.ping()]);
    return { status: reachable.every(Boolean) ? 'ok' : 'unavailable' };
  }
}
