import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module.js';
import { HooksModule } from '../hooks/hooks.module.js';
import { CustomerFieldValuesController } from './customer-field-values.controller.js';
import { CustomerFieldsController } from './customer-fields.controller.js';

/** The custom fields and their values; SecretBox (sealing sensitive values) is the one HooksModule reads from the environment. */
@Module({
  imports: [DatabaseModule, HooksModule],
  controllers: [CustomerFieldsController, CustomerFieldValuesController],
})
export class CustomerFieldsModule {}
