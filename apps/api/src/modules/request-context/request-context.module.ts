import { readMemberContext } from '@gani/db';
import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { AuthService } from '../auth/auth.service.js';
import { DatabaseModule } from '../database/database.module.js';
import { DatabaseService } from '../database/database.service.js';
import { MeController } from './me.controller.js';
import { ORGANISATION_SOURCES, type OrganisationSources } from './org-selection.js';
import { SessionResolver } from './session-resolver.js';

/**
 * One SessionResolver for the whole application, so the layers of a request (the 2FA gate, the tenant middleware) share one lookup;
 * and one OrganisationSources, so /v1, the socket and `GET /v1/me` choose an organisation from the same reads.
 */
@Module({
  imports: [AuthModule, DatabaseModule],
  controllers: [MeController],
  providers: [
    {
      provide: SessionResolver,
      useFactory: (auth: AuthService) => new SessionResolver(auth.auth),
      inject: [AuthService],
    },
    {
      provide: ORGANISATION_SOURCES,
      useFactory: (auth: AuthService, database: DatabaseService): OrganisationSources => ({
        organisations: (userId) => auth.activeOrganisationIds(userId),
        member: (orgId, userId) =>
          database.withTenant({ orgId, workspaceIds: [] }, (tx) => readMemberContext(tx, userId)),
      }),
      inject: [AuthService, DatabaseService],
    },
  ],
  exports: [SessionResolver, ORGANISATION_SOURCES],
})
export class RequestContextModule {}
