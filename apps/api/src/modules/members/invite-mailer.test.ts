import type { PendingInvite } from '@gani/db';
import { EmailSendError, type EmailMessage } from '@gani/email';
import { Logger } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { InviteMailer, memberInvitation } from './invite-mailer.js';

const invite: PendingInvite = {
  id: '01890000-0000-7000-8000-000000000001',
  invitedEmail: 'lan@example.test',
  role: 'sales',
  expiresAt: new Date('2026-10-29T00:00:00Z'),
};

describe('memberInvitation', () => {
  it('goes to the invited email, names the organisation and the role, and puts the token in the fragment', () => {
    const mail = memberInvitation('https://app.example.test', 'Gani Foods', invite, 'tok_en');
    expect(mail.to).toBe('lan@example.test');
    expect(mail.subject).toContain('Gani Foods');
    expect(mail.text).toContain('vai trò Sales');
    expect(mail.text).toContain('https://app.example.test/invite#token=tok_en');
    expect(mail.text).toContain('7 ngày');
  });
});

describe('InviteMailer', () => {
  it('answers whether the email left, and logs a failure with its code and the id only', async () => {
    const sent: EmailMessage[] = [];
    const close = vi.fn(() => Promise.resolve());
    const ok = new InviteMailer(
      { send: (m) => Promise.resolve(void sent.push(m)), close },
      'https://a.test',
    );
    expect(await ok.send('G', invite, 't')).toBe(true);
    expect(sent).toHaveLength(1);
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const failing = new InviteMailer(
      { send: () => Promise.reject(new EmailSendError('ESOCKET')), close },
      'https://a.test',
    );
    expect(await failing.send('G', invite, 'secret-token')).toBe(false);
    expect(warn.mock.calls).toEqual([[`invitation not sent (ESOCKET) member=${invite.id}`]]);
    await failing.onApplicationShutdown();
    expect(close).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});
