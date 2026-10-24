import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module.js';
import { TeamsController } from './teams.controller.js';

@Module({ imports: [DatabaseModule], controllers: [TeamsController] })
export class TeamsModule {}
