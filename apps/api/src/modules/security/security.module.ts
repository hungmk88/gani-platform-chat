import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module.js';
import { SecurityController } from './security.controller.js';

@Module({ imports: [DatabaseModule], controllers: [SecurityController] })
export class SecurityModule {}
