import { createTransport } from 'nodemailer';

import type { EmailConfig, EmailMessage, EmailSender } from './policy.js';

/** The message was not taken. `code` is the only cause given (a Node or SMTP code such as ECONNREFUSED, EAUTH): no address, no text. */
export class EmailSendError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(`email not sent (${code})`);
    this.name = 'EmailSendError';
    this.code = code;
  }
}

const SAFE_CODE = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
/** Milliseconds to wait for each step of SMTP, so a dead server fails the call instead of holding it. */
export const SMTP_TIMEOUT_MS = 10_000;

/** An EmailSender over SMTP (nodemailer, its logger off): one pooled-less transport, short timeouts. */
export function createSmtpSender(config: EmailConfig): EmailSender {
  const transport = createTransport(
    {
      url: config.url,
      connectionTimeout: SMTP_TIMEOUT_MS,
      greetingTimeout: SMTP_TIMEOUT_MS,
      socketTimeout: SMTP_TIMEOUT_MS,
      logger: false,
      debug: false,
    },
    { from: config.from },
  );
  return {
    async send(message: EmailMessage): Promise<void> {
      try {
        await transport.sendMail({
          to: message.to,
          subject: message.subject,
          text: message.text,
          ...(message.html === undefined ? {} : { html: message.html }),
        });
      } catch (error) {
        const code = (error as { code?: unknown }).code;
        throw new EmailSendError(
          typeof code === 'string' && SAFE_CODE.test(code) ? code : 'E_SEND',
        );
      }
    },
    close(): Promise<void> {
      transport.close();
      return Promise.resolve();
    },
  };
}
