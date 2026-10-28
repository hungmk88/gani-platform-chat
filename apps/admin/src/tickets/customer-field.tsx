'use client';

import { useDeferredValue, useState } from 'react';

import { MAX_QUERY, type Customer, type CustomerPage } from '../customers/customers';
import { useApiQuery } from '../query/provider';
import { customerLine, customerSearchPath } from './ticket-create';

const field = 'rounded-input border border-border-strong px-3 py-2';
const button = 'rounded-input border border-border-strong px-3 py-1 disabled:opacity-70';

/**
 * "Khách hàng (không bắt buộc)" of "Tạo ticket" from the list (#359): asks `GET /v1/customers` only once something is typed, one
 * page of `CUSTOMER_PICKS`; picked, it shows the customer with "Bỏ chọn". Phones and emails are shown as the API gives them.
 * Masking: the API masks phones and emails for Marketing and Viewer only (`customers.permissions.ts`), and they search by name
 * only. The roles that make tickets (Owner, Admin, Manager, Sales, Support) see them whole, so the lines and the search hint hold.
 * If making tickets is opened to Marketing or Viewer, look at this field again: they would get masked lines and no phone search.
 */
export function CustomerField({
  value,
  onChange,
}: {
  value: Customer | null;
  onChange: (c: Customer | null) => void;
}) {
  const [q, setQ] = useState('');
  const asked = useDeferredValue(q).trim().slice(0, MAX_QUERY);
  const found = useApiQuery<CustomerPage>(
    ['customers', 'pick', asked],
    customerSearchPath(asked),
    asked.length > 0,
  );

  if (value)
    return (
      <div className="flex flex-col gap-1">
        <span>Khách hàng (không bắt buộc)</span>
        <p className="flex flex-wrap items-center gap-2">
          <span>Khách: {customerLine(value)}</span>
          <button type="button" className={button} onClick={() => onChange(null)}>
            Bỏ chọn
          </button>
        </p>
      </div>
    );
  return (
    <div className="flex flex-col gap-1">
      <label className="flex flex-col gap-1">
        Khách hàng (không bắt buộc)
        <input
          type="search"
          value={q}
          maxLength={MAX_QUERY}
          placeholder="Gõ tên, SĐT hoặc email khách"
          className={field}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.preventDefault(); // Enter searches as typed; it never sends the ticket
          }}
        />
      </label>
      {!asked ? null : found.isPending ? (
        <p role="status" aria-busy="true" className="text-text-muted">
          Đang tìm khách…
        </p>
      ) : found.isError ? (
        <p>{found.error.error.message}</p>
      ) : found.data.data.length === 0 ? (
        <p>Không có khách khớp &quot;{asked}&quot;.</p>
      ) : (
        <>
          <ul aria-label="Khách tìm được" className="flex flex-col gap-1">
            {found.data.data.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  className={`${button} w-full text-left`}
                  onClick={() => {
                    onChange(c);
                    setQ('');
                  }}
                >
                  {customerLine(c)}
                </button>
              </li>
            ))}
          </ul>
          {found.data.nextCursor ? (
            <p className="text-12 text-text-muted">Gõ thêm để thu hẹp.</p>
          ) : null}
        </>
      )}
    </div>
  );
}
