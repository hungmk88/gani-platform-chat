/** One message: plain text always (every mail client reads it); HTML optional. */
export interface EmailMessage {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly html?: string;
}

export interface EmailSender {
  /** Resolves once the server took the message; rejects with EmailSendError otherwise. */
  send(message: EmailMessage): Promise<void>;
  close(): Promise<void>;
}

export interface EmailConfig {
  /** smtp:// or smtps:// with the account in it: a secret, never logged nor put in an error. */
  readonly url: string;
  readonly from: string;
}

/** Mailpit of `docker compose` (README): what development uses when SMTP_URL is not set. */
export const MAILPIT_URL = 'smtp://127.0.0.1:1025';
const DEV_FROM = 'Gani <no-reply@localhost>';

/** A setting that keeps the process from starting: it names the variable, never its value. */
export class EmailConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmailConfigError';
  }
}

/**
 * The SMTP server and the sender address for this environment (N149). `APP_ENV=production` needs SMTP_URL and EMAIL_FROM, and the
 * connection must be encrypted (smtps://, or smtp:// with `requireTLS=true`): an invitation must not cross the network in clear text.
 * Elsewhere a missing SMTP_URL means Mailpit, with a warning.
 */
export function emailPolicy(
  env: Record<string, string | undefined>,
  warn: (line: string) => void = () => undefined,
): EmailConfig {
  const production = env['APP_ENV'] === 'production';
  const url = env['SMTP_URL']?.trim() ?? '';
  const from = env['EMAIL_FROM']?.trim() ?? '';
  if (production && !url)
    throw new EmailConfigError('SMTP_URL is not set: email is required in production');
  if (production && !from)
    throw new EmailConfigError('EMAIL_FROM is not set: email is required in production');
  if (!url) {
    warn('SMTP_URL is not set: email goes to Mailpit on 127.0.0.1:1025 (not for production)');
    return { url: MAILPIT_URL, from: from || DEV_FROM };
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new EmailConfigError('SMTP_URL is not a URL');
  }
  if (parsed.protocol !== 'smtp:' && parsed.protocol !== 'smtps:')
    throw new EmailConfigError('SMTP_URL must start with smtp:// or smtps://');
  const encrypted =
    parsed.protocol === 'smtps:' || parsed.searchParams.get('requireTLS') === 'true';
  if (production && !encrypted)
    throw new EmailConfigError(
      'SMTP_URL must be encrypted in production: smtps://, or smtp:// with ?requireTLS=true',
    );
  return { url, from: from || DEV_FROM };
}
