import { Module } from '@nestjs/common';

import { ConversationStateMachine } from './conversation-state-machine.js';
import { MessageService } from './message-service.js';

/** One ConversationStateMachine and one MessageService for the application. They hold no connection: callers hand them the TenantTx of their own transaction. */
@Module({
  providers: [
    { provide: ConversationStateMachine, useFactory: () => new ConversationStateMachine() },
    {
      provide: MessageService,
      useFactory: (fsm: ConversationStateMachine) => new MessageService(fsm),
      inject: [ConversationStateMachine],
    },
  ],
  exports: [ConversationStateMachine, MessageService],
})
export class ConversationsModule {}
