import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module.js';
import { TagsController } from './tags.controller.js';

@Module({ imports: [DatabaseModule], controllers: [TagsController] })
export class TagsModule {}
