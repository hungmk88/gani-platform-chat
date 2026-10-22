import type { AddressInfo } from 'node:net';

import { SMTPServer } from 'smtp-server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createSmtpSender, EmailSendError } from './smtp-sender.js';

// A real SMTP conversation with an SMTP server in this process (the library Mailpit-like servers are built on): what the sender
// hands over, and what it says when there is no server. Nothing may be written to the console on either path.
const received: { to: string[]; data: string }[] = [];
let server: SMTPServer;
let port = 0;

beforeAll(async () => {
  server = new SMTPServer({
    authOptional: true,
    disabledCommands: ['STARTTLS'],
    logger: false,
    onData(stream, session, done) {
      let data = '';
      stream.on('data', (chunk: Buffer) => (data += chunk.toString('utf8')));
      stream.on('end', () => {
        received.push({ to: session.envelope.rcptTo.map((r) => r.address), data });
        done();
      });
    },
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.server.address() as AddressInfo).port;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

describe('createSmtpSender', () => {
  it('hands the message to the server with the configured sender, and writes nothing to the console', async () => {
    const log = vi.spyOn(console, 'log');
    const error = vi.spyOn(console, 'error');
    const sender = createSmtpSender({
      url: `smtp://127.0.0.1:${port}`,
      from: 'Gani <no-reply@example.test>',
    });
    await sender.send({
      to: 'lan@example.test',
      subject: 'Lời mời',
      text: 'Open https://x.test/invite/abc',
    });
    await sender.close();
    expect(received).toHaveLength(1);
    expect(received[0]?.to).toEqual(['lan@example.test']);
    expect(received[0]?.data).toContain('From: Gani <no-reply@example.test>');
    expect(received[0]?.data).toContain('https://x.test/invite/abc');
    expect(log).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it('fails with a code only when nobody answers: no address, no URL, no text in the error', async () => {
    const sender = createSmtpSender({
      url: 'smtp://user:s3cret@127.0.0.1:1',
      from: 'a@example.test',
    });
    const failure = await sender
      .send({ to: 'lan@example.test', subject: 'Lời mời', text: 'token-xyz' })
      .catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(EmailSendError);
    expect((failure as EmailSendError).code).toMatch(/^E[A-Z]+$/);
    expect(
      JSON.stringify({ m: (failure as Error).message, s: (failure as Error).stack }),
    ).not.toMatch(/lan@|s3cret|token-xyz/);
  });
});
