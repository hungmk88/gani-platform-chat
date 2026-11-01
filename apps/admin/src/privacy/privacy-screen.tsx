'use client';

import { useState } from 'react';

import type { NavItem } from '../nav';
import { button, Paged } from '../paged-list';
import { PendingPage } from '../pending-page';
import { useApiPages } from '../query/provider';
import { EraseDialog } from './erase-dialog';
import { KIND, STATUS } from './labels';
import {
  customerOf,
  customerTitleOf,
  requestsPath,
  timeText,
  type PrivacyRequest,
  type PrivacyRequestPage,
} from './privacy';
import { RequestDialog } from './request-dialog';

const primary = 'self-start rounded-input bg-accent px-4 py-2 text-accent-on';
const TONE = { ok: 'bg-ok-bg text-ok-text', error: 'bg-error-bg text-error-text' };

/**
 * #23 Dữ liệu khách of the company (CEO 30/10): the requests on customers' personal data, newest first, by cursor as #29
 * (`Paged`). PR B1: "Ghi nhận yêu cầu" records one (`RequestDialog`); PR B2: a pending `erase` is carried out with
 * `EraseDialog`. Carrying out an `export` is not in this version. A 404 means the API does not serve the route yet (planned S5):
 * the screen then says it is not there, never a list made up here. The reason is plain text, wrapped, never cut.
 */
export function PrivacyScreen({ item, go }: { item: NavItem; go: NavItem }) {
  const requests = useApiPages<PrivacyRequestPage>(['privacy-requests'], requestsPath);
  const [recording, setRecording] = useState(false);
  const [erasing, setErasing] = useState<PrivacyRequest | null>(null);
  if (requests.isError && requests.error.error.code === 'not_found')
    return <PendingPage item={item} go={go} />;
  return (
    <section aria-labelledby="privacy-title" className="flex max-w-[1080px] flex-col gap-6">
      <h1 id="privacy-title" className="text-20 font-semibold">
        Dữ liệu khách
      </h1>
      <button type="button" className={primary} onClick={() => setRecording(true)}>
        Ghi nhận yêu cầu
      </button>
      <section aria-labelledby="requests-title" className="flex flex-col gap-3">
        <h2 id="requests-title" tabIndex={-1} className="text-16 font-semibold">
          Yêu cầu dữ liệu cá nhân
        </h2>
        <Paged
          query={requests}
          loading="Đang tải yêu cầu…"
          empty={
            <div className="flex flex-col items-start gap-2">
              <p>Chưa có yêu cầu nào về dữ liệu cá nhân.</p>
              <button
                type="button"
                className={button}
                disabled={requests.isFetching}
                aria-busy={requests.isFetching}
                onClick={() => void requests.refetch()}
              >
                Làm mới
              </button>
            </div>
          }
          head={[
            'Khách',
            'Yêu cầu',
            'Trạng thái',
            'Lý do',
            'Người ghi nhận',
            'Ghi nhận lúc',
            'Thực hiện lúc',
            'Thao tác',
          ]}
          row={(r) => {
            const [word, tone] = STATUS[r.status];
            return (
              <tr key={r.id}>
                <td className="p-2">{customerOf(r)}</td>
                <td className="p-2">{KIND[r.kind]}</td>
                <td className="p-2">
                  <span
                    className={`rounded-input px-2 py-1 text-12 ${tone ? TONE[tone] : 'bg-bg-subtle'}`}
                  >
                    {word}
                  </span>
                </td>
                <td className="p-2 break-words whitespace-pre-wrap">{r.reason}</td>
                <td className="p-2">{r.requestedBy.name}</td>
                <td className="p-2 whitespace-nowrap">{timeText(r.createdAt)}</td>
                <td className="p-2 whitespace-nowrap">{timeText(r.executedAt)}</td>
                <td className="p-2">
                  {r.kind === 'erase' && r.status === 'pending' ? (
                    <button
                      type="button"
                      className={button}
                      aria-label={`Xóa dữ liệu của ${customerTitleOf(r)}`}
                      onClick={() => setErasing(r)}
                    >
                      Xóa dữ liệu…
                    </button>
                  ) : null}
                </td>
              </tr>
            );
          }}
        />
      </section>
      <p className="text-12 text-text-muted">Không áp dụng AI ở màn này.</p>
      {recording ? <RequestDialog onClose={() => setRecording(false)} /> : null}
      {erasing ? <EraseDialog request={erasing} onClose={() => setErasing(null)} /> : null}
    </section>
  );
}
