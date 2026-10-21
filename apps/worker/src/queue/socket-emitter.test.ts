import { EventEmitter } from 'node:events';

import { describe, expect, it, vi } from 'vitest';

import { QueueDownError } from './bullmq-publisher.js';
import { agentEmitterOver } from './socket-emitter.js';

// The connection is a fake that records what is published; the real one runs against Valkey in test/realtime-e2e.spec.ts.
function setup(status = 'ready') {
  const published: { channel: string; size: number }[] = [];
  const connection = Object.assign(new EventEmitter(), {
    status,
    answer: (): Promise<unknown> => Promise.resolve(1),
    publish: vi.fn((channel: string, message: string | Buffer) => {
      published.push({ channel, size: message.length });
      return connection.answer();
    }),
    quit: vi.fn(() => Promise.resolve('OK')),
    disconnect: vi.fn(),
  });
  return { connection, published, emitter: agentEmitterOver(connection, 50) };
}

describe('agentEmitterOver', () => {
  it('publishes a packet of the /agent namespace on the channel of its room', async () => {
    const t = setup();
    await t.emitter.emit(['conv:c1'], 'message.created', { eventId: 'e1' });
    await t.emitter.emit(['ws:w1', 'user:u1'], 'conversation.assigned', { eventId: 'e2' });
    expect(t.published.map((p) => p.channel)).toEqual([
      'socket.io#/agent#conv:c1#',
      'socket.io#/agent#',
    ]);
  });

  it('throws when Valkey refuses or does not answer in time, so the job is tried again', async () => {
    const t = setup();
    t.connection.answer = () => Promise.reject(new Error('Connection is closed.'));
    await expect(t.emitter.emit(['conv:c1'], 'x', {})).rejects.toThrow('Connection is closed.');
    t.connection.answer = () => new Promise(() => undefined);
    await expect(t.emitter.emit(['conv:c1'], 'x', {})).rejects.toBeInstanceOf(QueueDownError);
  });

  it('waits for a connection that is coming up, and gives up on one that does not', async () => {
    const t = setup('connecting');
    const sent = t.emitter.emit(['conv:c1'], 'x', {});
    t.connection.status = 'ready';
    t.connection.emit('ready');
    await sent;
    expect(t.published).toHaveLength(1);
    await expect(setup('connecting').emitter.emit(['conv:c1'], 'x', {})).rejects.toBeInstanceOf(
      QueueDownError,
    );
  });

  it('quits a connection that is up and drops one that is not', async () => {
    const up = setup();
    await up.emitter.close();
    expect(up.connection.quit).toHaveBeenCalledOnce();
    const down = setup('reconnecting');
    await down.emitter.close();
    expect(down.connection.disconnect).toHaveBeenCalledOnce();
  });
});
