import { Injectable } from '@nestjs/common';

import { AuthService } from '../auth/auth.service.js';
import { DatabaseService } from '../database/database.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';

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
    private readonly realtime: RealtimeService,
  ) {}

  /** Liveness: the process is up. Never touches a dependency. */
  liveness(): Liveness {
    return { status: 'ok' };
  }

  /** Readiness: can the API reach its databases (the one of the application, the one of sign-in) and Valkey when realtime uses it? */
  async readiness(): Promise<Readiness> {
    const reachable = await Promise.all([
      this.database.ping(),
      this.authService.ping(),
      this.realtime.ping(),
    ]);
    return { status: reachable.every(Boolean) ? 'ok' : 'unavailable' };
  }
}
