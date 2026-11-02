import { describe, expect, it } from 'vitest';

import { createChannelSenders } from './senders.js';

describe('createChannelSenders', () => {
  it('gives no sender before O3: the Zalo send API waits for Q6 (N185)', () => {
    expect(createChannelSenders()).toEqual({});
  });
});
