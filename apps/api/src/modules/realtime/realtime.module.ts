import { Module } from '@nestjs/common';

import { RealtimeService } from './realtime.service.js';

/** Socket.IO /agent (realtime spec). `setupApp` attaches it to the HTTP server with the providers of auth and the database. */
@Module({ providers: [RealtimeService], exports: [RealtimeService] })
export class RealtimeModule {}
