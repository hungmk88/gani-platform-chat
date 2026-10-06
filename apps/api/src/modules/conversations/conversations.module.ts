import { Module } from '@nestjs/common';

import { ConversationStateMachine } from './conversation-state-machine.js';

/** One ConversationStateMachine for the application. It holds no connection: callers hand it the TenantTx of their own transaction. */
@Module({
  providers: [
    { provide: ConversationStateMachine, useFactory: () => new ConversationStateMachine() },
  ],
  exports: [ConversationStateMachine],
})
export class ConversationsModule {}
