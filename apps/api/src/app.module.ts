import { Module } from '@nestjs/common';

import { AuthModule } from './modules/auth/auth.module.js';
import { ConversationsModule } from './modules/conversations/conversations.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { HooksModule } from './modules/hooks/hooks.module.js';
import { MembersModule } from './modules/members/members.module.js';
import { RealtimeModule } from './modules/realtime/realtime.module.js';
import { RequestContextModule } from './modules/request-context/request-context.module.js';
import { TeamsModule } from './modules/teams/teams.module.js';
import { WorkspacesModule } from './modules/workspaces/workspaces.module.js';

@Module({
  imports: [
    AuthModule,
    ConversationsModule,
    HealthModule,
    HooksModule,
    MembersModule,
    RealtimeModule,
    RequestContextModule,
    TeamsModule,
    WorkspacesModule,
  ],
})
export class AppModule {}
