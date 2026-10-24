import { notFound } from 'next/navigation';

import { roleOf } from '../../../src/me';
import { getMe } from '../../../src/me.server';
import { builtFor, menuItemAt } from '../../../src/nav';
import { PendingPage } from '../../../src/pending-page';

/**
 * Any path of a signed-in person that no screen answers. An item of their menu not built yet says so (`PendingPage`); anything else
 * is the 404 inside the frame, so the menu stays.
 */
export default async function Unknown({ params }: { params: Promise<{ rest: string[] }> }) {
  const { rest } = await params;
  const result = await getMe();
  const role = result.kind === 'ok' ? roleOf(result.me) : null;
  const item = role ? menuItemAt(role, `/${rest.join('/')}`) : undefined;
  if (!role || !item) notFound();
  return <PendingPage item={item} go={builtFor(role)} />;
}
