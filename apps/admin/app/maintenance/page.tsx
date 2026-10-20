import Link from 'next/link';

import { SystemPage } from '../../src/system-page';

export default function Maintenance() {
  return (
    <SystemPage
      kind="maintenance"
      action={
        <Link className="inline-block rounded-input bg-accent px-4 py-2 text-accent-on" href="/">
          Tải lại
        </Link>
      }
    />
  );
}
