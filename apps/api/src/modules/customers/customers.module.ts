import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module.js';
import { CustomerMergeController } from './customer-merge.controller.js';
import { CustomersController } from './customers.controller.js';

@Module({ imports: [DatabaseModule], controllers: [CustomersController, CustomerMergeController] })
export class CustomersModule {}
