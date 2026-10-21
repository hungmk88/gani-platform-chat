import { describe, expect, it } from 'vitest';

import { normalizeZalo, zaloPlatformMessageId } from './zalo-normalize.js';
import { parseZaloEvent, verifyZaloSignature, zaloSignature } from './zalo.js';

// Fixtures in the shape the code assumes (Q6: unverified, Z-a/Z-b/Z-e), signed as the recorded formula says (zalo spec §6).
const secrets = { appId: '1234567890', oaSecretKey: 'oa-secret-of-the-test' };
const NOW = new Date('2026-10-20T10:00:00Z');
const body = (over: Record<string, unknown> = {}) =>
  Buffer.from(
    JSON.stringify({
      app_id: secrets.appId,
      event_name: 'user_send_text',
      timestamp: String(NOW.getTime()),
      sender: { id: 'zalo-user-1' },
      recipient: { id: 'oa-1' },
      message: { msg_id: 'msg-1', text: 'Café giá bao nhiêu?' },
      ...over,
    }),
  );
const signed = (raw: Buffer) => {
  const event = parseZaloEvent(raw);
  if (!event) throw new Error('fixture does not parse');
  return { event, header: zaloSignature(raw, event.timestamp, secrets) };
};

describe('verifyZaloSignature (Z-N1, Z-N2)', () => {
  it('accepts the signature of the body, in either case', () => {
    const raw = body();
    const { event, header } = signed(raw);
    expect(verifyZaloSignature({ rawBody: raw, header, event, secrets, now: NOW })).toBe(true);
    expect(
      verifyZaloSignature({
        rawBody: raw,
        header: header.toUpperCase().replace('MAC=', 'mac='),
        event,
        secrets,
        now: NOW,
      }),
    ).toBe(true);
  });

  it('refuses a changed body, another key or app, a missing or malformed header, and a timestamp out of tolerance', () => {
    const raw = body();
    const { event, header } = signed(raw);
    const check = (over: Partial<Parameters<typeof verifyZaloSignature>[0]>) =>
      verifyZaloSignature({ rawBody: raw, header, event, secrets, now: NOW, ...over });
    expect(check({ rawBody: Buffer.concat([raw, Buffer.from(' ')]) })).toBe(false);
    expect(check({ secrets: { ...secrets, oaSecretKey: 'another' } })).toBe(false);
    expect(check({ secrets: { ...secrets, appId: '999' } })).toBe(false);
    for (const h of [undefined, '', 'mac=', 'sha256=' + header.slice(4), header.slice(0, -1)])
      expect(check({ header: h }), String(h)).toBe(false);
    expect(check({ now: new Date(NOW.getTime() + 301_000) })).toBe(false);
    expect(check({ now: new Date(NOW.getTime() - 301_000) })).toBe(false);
    expect(check({ now: new Date(NOW.getTime() + 299_000) })).toBe(true);
  });

  it('reads no event from a body that is not a JSON object with a name and a timestamp', () => {
    for (const raw of [
      'not json',
      '[]',
      '{}',
      '{"event_name":"x"}',
      '{"event_name":"x","timestamp":"soon"}',
    ])
      expect(parseZaloEvent(Buffer.from(raw)), raw).toBeNull();
    expect(parseZaloEvent(body({ timestamp: NOW.getTime() }))).toMatchObject({
      timestamp: String(NOW.getTime()),
    });
  });
});

describe('normalizeZalo (inbound spec §3, I5, I7)', () => {
  it('makes a text message of the customer, in NFC, with the platform id and time', () => {
    const raw = body();
    expect(normalizeZalo(signed(raw).event, raw)).toEqual({
      kind: 'message',
      externalUserId: 'zalo-user-1',
      platformMessageId: 'msg-1',
      messageKind: 'text',
      body: 'Café giá bao nhiêu?'.normalize('NFC'),
      platformSentAt: NOW,
    });
  });

  it('keeps an image, a file or a sticker with no body, and ignores what is not a message with a fixed reason', () => {
    for (const [name, kind] of [
      ['user_send_image', 'image'],
      ['user_send_file', 'file'],
      ['user_send_sticker', 'sticker'],
    ] as const) {
      const raw = body({ event_name: name, message: { msg_id: 'm' } });
      expect(normalizeZalo(signed(raw).event, raw)).toMatchObject({
        kind: 'message',
        messageKind: kind,
        body: null,
      });
    }
    const ignored = (over: Record<string, unknown>) => {
      const raw = body(over);
      return normalizeZalo(signed(raw).event, raw);
    };
    expect(ignored({ event_name: 'follow' })).toEqual({
      kind: 'ignored',
      reason: 'I_NOT_A_MESSAGE',
    });
    expect(ignored({ sender: {} })).toEqual({ kind: 'ignored', reason: 'I_NO_SENDER' });
    expect(ignored({ message: { msg_id: 'm', text: '  ' } })).toEqual({
      kind: 'ignored',
      reason: 'I_NO_TEXT',
    });
  });

  it('keys an event without a message id by the sha256 of its raw body', () => {
    const raw = body({ message: { text: 'no id' } });
    expect(zaloPlatformMessageId(signed(raw).event, raw)).toMatch(/^raw:[0-9a-f]{64}$/);
    expect(zaloPlatformMessageId(signed(raw).event, raw)).toBe(
      zaloPlatformMessageId(signed(raw).event, Buffer.from(raw)),
    );
  });
});
