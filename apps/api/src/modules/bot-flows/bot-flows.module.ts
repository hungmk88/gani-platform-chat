import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module.js';
import { BotFlowsController } from './bot-flows.controller.js';

@Module({ imports: [DatabaseModule], controllers: [BotFlowsController] })
export class BotFlowsModule {}
