import { redirect } from 'next/navigation';

import { roleOf } from '../../src/me';
import { getMe } from '../../src/me.server';
import { homeFor } from '../../src/nav';

/** `/` opens the page of the role (apps/admin/CLAUDE.md "Trang mặc định"); the layout has already handled the other answers. */
export default async function Home() {
  const result = await getMe();
  const role = result.kind === 'ok' ? roleOf(result.me) : null;
  if (role) redirect(homeFor(role));
  return null;
}
