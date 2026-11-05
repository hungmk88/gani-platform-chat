import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module.js';
import { LeadsController } from './leads.controller.js';

@Module({ imports: [DatabaseModule], controllers: [LeadsController] })
export class LeadsModule {}
