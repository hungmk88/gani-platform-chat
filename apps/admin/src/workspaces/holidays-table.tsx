import type { ReactNode } from 'react';

import { spanText, type Holiday } from './holidays';

const button = 'rounded-input border border-border-strong px-4 py-2 disabled:opacity-70';

/** The days off as read (2b-i): none to come with "Làm mới", or the table. */
export function HolidaysRead(p: { days: readonly Holiday[]; busy: boolean; refresh: () => void }) {
  if (p.days.length > 0) return <HolidayTable days={p.days} />;
  return (
    <div className="flex flex-col items-start gap-2">
      <p>Workspace chưa có ngày nghỉ nào sắp tới.</p>
      <button
        type="button"
        className={button}
        disabled={p.busy}
        aria-busy={p.busy}
        onClick={p.refresh}
      >
        Làm mới
      </button>
    </div>
  );
}

/** The days off in the order of the API (by start); `actions` adds a last column (2b-ii: change, remove). */
export function HolidayTable({
  days,
  actions,
}: {
  days: readonly Holiday[];
  actions?: (h: Holiday) => ReactNode;
}) {
  return (
    <table className="w-full text-left">
      <thead className="text-12 text-text-muted">
        <tr>
          {['Ngày nghỉ', 'Ngày', ...(actions ? ['Thao tác'] : [])].map((h) => (
            <th key={h} scope="col" className="py-2 pr-4 font-normal">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {days.map((h) => (
          <tr key={h.id} className="border-t border-border">
            <td className="py-2 pr-4">{h.name}</td>
            <td className="py-2 pr-4 whitespace-nowrap">{spanText(h)}</td>
            {actions ? <td className="py-2">{actions(h)}</td> : null}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
