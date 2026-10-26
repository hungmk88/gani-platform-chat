import { describe, expect, it } from 'vitest';

import {
  preChatProblem,
  RetryLater,
  sendWithRetry,
  waitBefore,
  withMessage,
  type Message,
} from './chat';

describe('preChatProblem', () => {
  const ok = { name: ' Lan ', phone: '', marketing: false };
  it('needs a name, takes no phone or a Vietnamese one', () => {
    expect(preChatProblem(ok)).toBeNull();
    expect(preChatProblem({ ...ok, phone: '0912 345 678' })).toBeNull();
    expect(preChatProblem({ ...ok, phone: '+84.912.345.678' })).toBeNull();
    expect(preChatProblem({ ...ok, name: '  ' })).toBe('Nhập tên của bạn.');
    expect(preChatProblem({ ...ok, name: 'x'.repeat(101) })).toBe('Tên tối đa 100 ký tự.');
    expect(preChatProblem({ ...ok, phone: '12345' })).toContain('Số điện thoại chưa đúng');
  });
});

describe('waitBefore and sendWithRetry', () => {
  it('waits 1, 2, 4, 8 seconds, or what Retry-After says', () => {
    expect([1, 2, 3, 4].map((n) => waitBefore(n, new Error('x')))).toEqual([
      1000, 2000, 4000, 8000,
    ]);
    expect(waitBefore(1, new RetryLater(30))).toBe(30000);
  });
  it('tries again with the same key until it goes through', async () => {
    const keys: string[] = [];
    const waits: number[] = [];
    const sent = await sendWithRetry(
      (key) => {
        keys.push(key);
        return keys.length < 3 ? Promise.reject(new Error('offline')) : Promise.resolve('ok');
      },
      'k1',
      (ms) => {
        waits.push(ms);
        return Promise.resolve();
      },
    );
    expect(sent).toBe('ok');
    expect(keys).toEqual(['k1', 'k1', 'k1']);
    expect(waits).toEqual([1000, 2000]);
  });
  it('gives up after 5 tries with the last error', async () => {
    let tries = 0;
    await expect(
      sendWithRetry(
        () => {
          tries += 1;
          return Promise.reject(new Error(`fail ${tries}`));
        },
        'k',
        () => Promise.resolve(),
      ),
    ).rejects.toThrow('fail 5');
    expect(tries).toBe(5);
  });
});

describe('withMessage', () => {
  const a: Message = { id: 'a', from: 'customer', text: 'Chào', status: 'sending', key: 'k' };
  it('replaces a message by id, or adds it at the end', () => {
    expect(withMessage([a], { ...a, status: 'sent' })).toEqual([{ ...a, status: 'sent' }]);
    const b: Message = { id: 'b', from: 'staff', text: 'Dạ', status: 'sent' };
    expect(withMessage([a], b)).toEqual([a, b]);
  });
});
