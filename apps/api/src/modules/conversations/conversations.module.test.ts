import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';

import { ConversationStateMachine } from './conversation-state-machine.js';
import { ConversationsModule } from './conversations.module.js';

describe('ConversationsModule', () => {
  it('provides one ConversationStateMachine that needs no connection', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [ConversationsModule] }).compile();
    expect(moduleRef.get(ConversationStateMachine)).toBeInstanceOf(ConversationStateMachine);
  });
});
