import { Injectable } from '@nestjs/common';

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
  constructor(private readonly database: DatabaseService) {}

  /** Liveness: the process is up. Never touches a dependency. */
  liveness(): Liveness {
    return { status: 'ok' };
  }

  /** Readiness: can the API reach its database? (Valkey joins when BullMQ arrives, N52.) */
  async readiness(): Promise<Readiness> {
    return { status: (await this.database.ping()) ? 'ok' : 'unavailable' };
  }
}
