import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module.js';
import { AuditController } from './audit.controller.js';

@Module({ imports: [DatabaseModule], controllers: [AuditController] })
export class AuditModule {}
