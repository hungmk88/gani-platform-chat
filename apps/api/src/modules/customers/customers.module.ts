import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module.js';
import { CustomersController } from './customers.controller.js';

@Module({ imports: [DatabaseModule], controllers: [CustomersController] })
export class CustomersModule {}
