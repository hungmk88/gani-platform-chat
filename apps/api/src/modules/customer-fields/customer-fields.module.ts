import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module.js';
import { CustomerFieldsController } from './customer-fields.controller.js';

@Module({ imports: [DatabaseModule], controllers: [CustomerFieldsController] })
export class CustomerFieldsModule {}
