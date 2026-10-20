import { describe, expect, it } from 'vitest';

import { ValidationFailedError, ZodPipe } from '../../openapi/zod-pipe.js';
import { ConversationListQuerySchema } from './conversations.schemas.js';

describe('the query of GET /v1/conversations', () => {
  const pipe = new ZodPipe(ConversationListQuerySchema);

  it('takes the filters of the Inbox, with every one optional and assignee any by default', () => {
    expect(pipe.transform({})).toEqual({ limit: 50, assignee: 'any' });
    const ws = '0190a000-0000-7000-8000-000000000001';
    expect(
      pipe.transform({
        workspaceId: ws,
        state: 'HUMAN_WAITING_Q',
        hold: 'true',
        assignee: 'none',
        limit: '10',
      }),
    ).toEqual({
      workspaceId: ws,
      state: 'HUMAN_WAITING_Q',
      hold: 'true',
      assignee: 'none',
      limit: 10,
    });
  });

  it('refuses an unknown state, assignee or hold, and a workspace that is not a UUID', () => {
    for (const bad of [
      { state: 'OPEN' },
      { assignee: 'all' },
      { hold: 'yes' },
      { workspaceId: 'w1' },
    ])
      expect(() => pipe.transform(bad), JSON.stringify(bad)).toThrow(ValidationFailedError);
  });
});
