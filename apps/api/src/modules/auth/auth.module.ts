import { Module } from '@nestjs/common';

import { AuthService } from './auth.service.js';

@Module({
  providers: [{ provide: AuthService, useFactory: () => AuthService.fromEnv(process.env) }],
  exports: [AuthService],
})
export class AuthModule {}
