import { INVITE_DAYS, type OrgRole, type PendingInvite } from '@gani/db';
import { EmailSendError, type EmailMessage, type EmailSender } from '@gani/email';
import { Logger, type OnApplicationShutdown } from '@nestjs/common';

const ROLE_NAMES: Readonly<Record<OrgRole, string>> = {
  owner: 'Owner',
  admin: 'Admin',
  manager: 'Manager',
  sales: 'Sales',
  support: 'Support',
  marketing: 'Marketing',
  viewer: 'Viewer',
};

/**
 * The email of an invitation made by a member (DB-02b-c). The link goes to the page /invite of the application, on BETTER_AUTH_URL: the
 * page and /api/auth/invite/* share that one origin (N136, the plugin requires it as the Origin). The token is in the fragment (#),
 * which no server receives in a request line or its logs.
 */
export function memberInvitation(
  origin: string,
  orgName: string,
  invite: PendingInvite,
  token: string,
): EmailMessage {
  return {
    to: invite.invitedEmail,
    subject: `Lời mời tham gia ${orgName} trên Gani`,
    text: [
      `Bạn được mời tham gia ${orgName} trên nền tảng Gani với vai trò ${ROLE_NAMES[invite.role]}.`,
      '',
      `Nhận lời mời: ${origin}/invite#token=${token}`,
      '',
      `Liên kết dùng được một lần và hết hạn sau ${INVITE_DAYS} ngày. Nếu bạn không chờ lời mời này, hãy bỏ qua email.`,
    ].join('\n'),
  };
}

/** Sends invitations after their transaction has committed. A failure is a `false` and a log line with its code only: no address. */
export class InviteMailer implements OnApplicationShutdown {
  private readonly logger = new Logger(InviteMailer.name);

  constructor(
    private readonly sender: EmailSender,
    private readonly origin: string,
  ) {}

  async send(orgName: string, invite: PendingInvite, token: string): Promise<boolean> {
    try {
      await this.sender.send(memberInvitation(this.origin, orgName, invite, token));
      return true;
    } catch (error) {
      const code = error instanceof EmailSendError ? error.code : 'unknown';
      this.logger.warn(`invitation not sent (${code}) member=${invite.id}`);
      return false;
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.sender.close();
  }
}
