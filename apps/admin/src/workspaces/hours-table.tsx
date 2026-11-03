import type { ReactNode } from 'react';

import { cellText, COLUMNS, WEEKDAY, type BusinessHours, type Column } from './hours';

/**
 * The week as a table, a row a day by weekday. `cell` draws each cell (the text to read, or what changes it), `name` names the
 * cell after its day and column ("Thứ 2 mở cửa"), for a label.
 */
export function HoursTable<D extends { readonly weekday: number }>({
  days,
  cell,
}: {
  days: readonly D[];
  cell: (d: D, column: Column, name: string) => ReactNode;
}) {
  return (
    <table className="w-full text-left">
      <thead className="text-12 text-text-muted">
        <tr>
          {['Ngày', ...COLUMNS.map(([, head]) => head)].map((h) => (
            <th key={h} className="py-2">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {[...days]
          .sort((a, b) => a.weekday - b.weekday)
          .map((d) => {
            const day = WEEKDAY[d.weekday] ?? `Ngày ${d.weekday}`;
            return (
              <tr key={d.weekday} className="border-t border-border">
                <th scope="row" className="py-2 font-normal">
                  {day}
                </th>
                {COLUMNS.map(([k, head]) => (
                  <td key={k} className="py-2">
                    {cell(d, k, `${day} ${head.toLowerCase()}`)}
                  </td>
                ))}
              </tr>
            );
          })}
      </tbody>
    </table>
  );
}

/** Above the week: whether it is still the default week of the system, and the time zone of the workspace. */
export function HoursHead({ hours }: { hours: BusinessHours }) {
  return (
    <>
      {hours.isDefault ? (
        <p className="text-12 text-text-muted">
          Workspace chưa đặt giờ riêng: đang dùng tuần mặc định của hệ thống.
        </p>
      ) : null}
      <p className="text-12 text-text-muted">Múi giờ: {hours.timezone}</p>
    </>
  );
}

/** The week as read (2a-i): its head, then the table in words. */
export function HoursWeek({ hours }: { hours: BusinessHours }) {
  return (
    <>
      <HoursHead hours={hours} />
      <HoursTable days={hours.week} cell={cellText} />
    </>
  );
}
