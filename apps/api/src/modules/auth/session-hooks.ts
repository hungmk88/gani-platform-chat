// Hook of Better Auth `databaseHooks.session.create.before` (N79, N81). What it does to every new session, whatever created it:
// ip_address and user_agent are blanked (the columns exist only because Better Auth writes them; sessions_*_check allow only ''),
// and the lifetime is cut to 12 hours (`rememberMe: false` would give 24, which sessions_lifetime_check refuses).
// The cap counts from the session's own createdAt, the value that is stored, so a clock that differs from the database's cannot
// break the CHECK.
export const MAX_SESSION_MS = 12 * 60 * 60 * 1000;

const time = (value: unknown, fallback: number): number =>
  value instanceof Date ? value.getTime() : fallback;

export function sessionCreateBefore(now: () => number = Date.now) {
  return (session: Record<string, unknown>): Promise<{ data: Record<string, unknown> }> => {
    const started = time(session['createdAt'], now());
    const latest = started + MAX_SESSION_MS;
    const expiresAt = new Date(Math.min(time(session['expiresAt'], latest), latest));
    return Promise.resolve({ data: { ...session, ipAddress: '', userAgent: '', expiresAt } });
  };
}
