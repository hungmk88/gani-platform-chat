import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module.js';
import { QuickRepliesController } from './quick-replies.controller.js';

@Module({ imports: [DatabaseModule], controllers: [QuickRepliesController] })
export class QuickRepliesModule {}
