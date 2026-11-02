import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module.js';
import { BusinessHoursController } from './business-hours.controller.js';

@Module({ imports: [DatabaseModule], controllers: [BusinessHoursController] })
export class BusinessHoursModule {}
