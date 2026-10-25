import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module.js';
import { ChannelsController } from './channels.controller.js';

@Module({ imports: [DatabaseModule], controllers: [ChannelsController] })
export class ChannelsModule {}
