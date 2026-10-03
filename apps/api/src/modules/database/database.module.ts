import { Module } from '@nestjs/common';

import { DatabaseService } from './database.service.js';

@Module({
  providers: [
    {
      provide: DatabaseService,
      useFactory: () => new DatabaseService(process.env['DATABASE_URL_APP']),
    },
  ],
  exports: [DatabaseService],
})
export class DatabaseModule {}
