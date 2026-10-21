import { SecretBox } from '@gani/channels';
import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module.js';

/** The webhooks of the channels (Brief P9). SecretBox reads CHANNEL_SECRET_KEY_<version> once; a malformed key stops the start. */
@Module({
  imports: [DatabaseModule],
  providers: [{ provide: SecretBox, useFactory: () => SecretBox.fromEnv(process.env) }],
  exports: [SecretBox],
})
export class HooksModule {}
