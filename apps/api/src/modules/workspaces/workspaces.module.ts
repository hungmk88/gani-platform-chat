import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module.js';
import { WorkspacesController } from './workspaces.controller.js';

@Module({ imports: [DatabaseModule], controllers: [WorkspacesController] })
export class WorkspacesModule {}
