import { Logger, Module } from '@nestjs/common';
import { ConversationStateMachine, MessageService } from '@gani/conversations';

import { DatabaseModule } from '../database/database.module.js';
import { ConversationActionsController } from './conversation-actions.controller.js';
import { ConversationsController } from './conversations.controller.js';

/** One ConversationStateMachine and one MessageService for the application. They hold no connection: callers hand them the TenantTx of their own transaction. */
@Module({
  imports: [DatabaseModule],
  controllers: [ConversationsController, ConversationActionsController],
  providers: [
    { provide: ConversationStateMachine, useFactory: () => new ConversationStateMachine() },
    {
      provide: MessageService,
      useFactory: (fsm: ConversationStateMachine) =>
        new MessageService(fsm, undefined, undefined, new Logger(MessageService.name)),
      inject: [ConversationStateMachine],
    },
  ],
  exports: [ConversationStateMachine, MessageService],
})
export class ConversationsModule {}
