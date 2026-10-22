import { createSmtpSender, emailPolicy } from '@gani/email';
import { Logger, Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { AuthService } from '../auth/auth.service.js';
import { DatabaseModule } from '../database/database.module.js';
import { InviteMailer } from './invite-mailer.js';
import { MembersController } from './members.controller.js';

/**
 * One InviteMailer for the application, for the invitations of members (DB-02b-c). Its settings are checked at start-up (N149):
 * APP_ENV=production without SMTP_URL, EMAIL_FROM or an encrypted connection stops the API; elsewhere a missing SMTP_URL means
 * Mailpit, with a warning.
 */
@Module({
  imports: [AuthModule, DatabaseModule],
  controllers: [MembersController],
  providers: [
    {
      provide: InviteMailer,
      useFactory: (auth: AuthService) => {
        const logger = new Logger(InviteMailer.name);
        const config = emailPolicy(process.env, (line) => logger.warn(line));
        return new InviteMailer(createSmtpSender(config), auth.origin);
      },
      inject: [AuthService],
    },
  ],
})
export class MembersModule {}
