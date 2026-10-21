import { Module } from '@nestjs/common';

import { AuthModule } from './modules/auth/auth.module.js';
import { ConversationsModule } from './modules/conversations/conversations.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { RequestContextModule } from './modules/request-context/request-context.module.js';

@Module({ imports: [AuthModule, ConversationsModule, HealthModule, RequestContextModule] })
export class AppModule {}
