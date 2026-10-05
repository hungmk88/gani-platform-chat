import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { AuthService } from '../auth/auth.service.js';
import { SessionResolver } from './session-resolver.js';

/** One SessionResolver for the whole application, so the layers of a request (tenant middleware now, the 2FA gate in 6d-3) share one lookup. */
@Module({
  imports: [AuthModule],
  providers: [
    {
      provide: SessionResolver,
      useFactory: (auth: AuthService) => new SessionResolver(auth.auth),
      inject: [AuthService],
    },
  ],
  exports: [SessionResolver],
})
export class RequestContextModule {}
