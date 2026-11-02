import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module.js';
import { TicketsController } from './tickets.controller.js';

@Module({ imports: [DatabaseModule], controllers: [TicketsController] })
export class TicketsModule {}
