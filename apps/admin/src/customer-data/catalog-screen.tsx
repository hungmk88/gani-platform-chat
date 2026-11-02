'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';

import { button } from '../paged-list';
import { useApiQuery } from '../query/provider';
import { RetryAction } from '../retry-button';
import {
  FIELD_TYPE,
  FIELDS_PATH,
  optionsText,
  TABS,
  TAGS_PATH,
  type CustomerField,
  type Tab,
  type Tag,
} from './catalog';

/** The links between the tabs of /settings/customer-data (links, not a tablist, as /me). */
export function CustomerDataNav({ tab }: { tab: Tab }) {
  return (
    <nav aria-label="Phần dữ liệu khách" className="flex gap-2 border-b border-border">
      {TABS.map(([k, label]) => (
        <Link
          key={k}
          href={`/settings/customer-data?tab=${k}`}
          aria-current={tab === k ? 'page' : undefined}
          className={`px-3 py-2 ${tab === k ? 'border-b-2 border-accent font-semibold' : 'text-text-muted'}`}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}

/** One list of the company read whole: loading, its own 404 line, error with trace and "Thử lại", empty, the table. */
function ReadList<R extends { readonly id: string }>(p: {
  title: string;
  path: string;
  empty: string;
  head: readonly string[];
  row: (r: R) => ReactNode;
}) {
  const list = useApiQuery<{ readonly data: readonly R[] }>(['customer-data', p.path], p.path);
  let body: ReactNode;
  if (list.isPending)
    body = (
      <p role="status" aria-busy="true" className="text-text-muted">
        Đang tải {p.title.toLowerCase()}…
      </p>
    );
  else if (list.isError && list.error.error.code === 'not_found')
    body = <p>{p.title}: chưa có trong bản hiện tại.</p>;
  else if (list.isError)
    body = (
      <div role="alert" className="flex flex-col gap-2">
        <p>{list.error.error.message}</p>
        {list.error.error.traceId ? (
          <p className="text-12 text-text-muted">Mã: {list.error.error.traceId}</p>
        ) : null}
        <RetryAction onRetry={() => void list.refetch()} busy={list.isFetching} />
      </div>
    );
  else if (list.data.data.length === 0)
    body = (
      <div className="flex flex-col items-start gap-2">
        <p>{p.empty}</p>
        <button
          type="button"
          className={button}
          disabled={list.isFetching}
          aria-busy={list.isFetching}
          onClick={() => void list.refetch()}
        >
          Làm mới
        </button>
      </div>
    );
  else
    body = (
      <div className="overflow-x-auto rounded-card border border-border">
        <table className="w-full text-left">
          <thead className="bg-bg-subtle">
            <tr>
              {p.head.map((t) => (
                <th key={t} scope="col" className="p-2 font-semibold">
                  {t}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">{list.data.data.map(p.row)}</tbody>
        </table>
      </div>
    );
  return (
    <section aria-labelledby="catalog-title" className="flex flex-col gap-3">
      <h2 id="catalog-title" className="text-16 font-semibold">
        {p.title}
      </h2>
      {body}
    </section>
  );
}

const yes = (v: boolean) => (v ? 'Có' : 'Không');
const shown = (hidden: boolean) => (hidden ? 'Đã ẩn' : 'Đang dùng');

/** The custom fields of the company, in the order the API gives (`position`), hidden ones too. */
function FieldList() {
  return (
    <ReadList<CustomerField>
      title="Trường tùy chỉnh"
      path={FIELDS_PATH}
      empty="Công ty chưa có trường tùy chỉnh nào."
      head={['Trường', 'Kiểu', 'Lựa chọn', 'Bắt buộc', 'Nhạy cảm', 'Dữ liệu', 'Trạng thái']}
      row={(f) => (
        <tr key={f.id}>
          <td className="p-2">{f.name}</td>
          <td className="p-2">{FIELD_TYPE[f.type]}</td>
          <td className="p-2">{optionsText(f)}</td>
          <td className="p-2">{yes(f.required)}</td>
          <td className="p-2">{yes(f.sensitive)}</td>
          <td className="p-2">{f.hasData ? 'Đã có' : 'Chưa có'}</td>
          <td className="p-2">{shown(f.hidden)}</td>
        </tr>
      )}
    />
  );
}

/** The tags of the company, by name (the API's order), hidden ones too. */
function TagList() {
  return (
    <ReadList<Tag>
      title="Tag"
      path={TAGS_PATH}
      empty="Công ty chưa có tag nào."
      head={['Tag', 'Số khách', 'Trạng thái']}
      row={(t) => (
        <tr key={t.id}>
          <td className="p-2">{t.name}</td>
          <td className="p-2">{t.customerCount}</td>
          <td className="p-2">{shown(t.hidden)}</td>
        </tr>
      )}
    />
  );
}

/**
 * #23 Dữ liệu khách, a tab of the company's catalog (CEO 02/11, brief 33, 46: 23a), read only: no create, edit, hide or delete
 * here (23b). Owner and Admin, as the menu (U36).
 */
export function CatalogScreen({ tab, nav }: { tab: Exclude<Tab, 'requests'>; nav: ReactNode }) {
  return (
    <section aria-labelledby="customer-data-title" className="flex max-w-[1080px] flex-col gap-6">
      <h1 id="customer-data-title" className="text-20 font-semibold">
        Dữ liệu khách
      </h1>
      {nav}
      {tab === 'fields' ? (
        <>
          <FieldList />
          <p className="text-12 text-text-muted">
            Giá trị của trường nhạy cảm được che với Marketing và Viewer.
          </p>
        </>
      ) : (
        <>
          <TagList />
          <p className="text-12 text-text-muted">
            Tag đã ẩn không gắn thêm cho khách được; khách đang mang vẫn giữ.
          </p>
        </>
      )}
      <p className="text-12 text-text-muted">
        Chỉ xem: không tạo, sửa, ẩn, gộp hay xóa ở màn này. Không áp dụng AI.
      </p>
    </section>
  );
}
