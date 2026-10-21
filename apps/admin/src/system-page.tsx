import Link from 'next/link';
import type { ReactNode } from 'react';

import { RetryButton } from './retry-button';

// The four system pages of the admin (Phụ lục C v3 dòng 0), with the words of prototype/dot1/system.js: one sentence, one action.
const PAGES = {
  forbidden: [
    'Bạn không có quyền xem trang này.',
    'Vai trò của bạn không dùng màn này. Nếu cần, nhờ Admin cấp quyền.',
  ],
  'not-found': ['Không tìm thấy trang.', 'Trang không tồn tại hoặc thuộc công ty khác.'],
  maintenance: ['Hệ thống đang bảo trì.', 'Tin khách gửi tới vẫn được lưu. Thử lại sau ít phút.'],
  error: [
    'Đã có lỗi.',
    'Không phải do bạn. Thử lại sau ít phút; nếu còn lỗi, gửi mã bên dưới cho Admin.',
  ],
} as const;

export function SystemPage({
  kind,
  traceId,
  action,
}: {
  kind: keyof typeof PAGES;
  traceId?: string | null;
  action?: ReactNode;
}) {
  const [title, text] = PAGES[kind];
  return (
    <main
      className="mx-auto flex max-w-[560px] flex-col gap-3 p-8"
      role={kind === 'error' ? 'alert' : undefined}
    >
      <h1 className="text-20 font-semibold">{title}</h1>
      <p className="text-text-muted">{text}</p>
      {kind === 'error' && traceId ? (
        <p className="text-12 text-text-muted">Mã: {traceId}</p>
      ) : null}
      <div>
        {action ??
          (kind === 'error' ? (
            // An error of the frame comes back on "/" too: going home would loop, so the one action is to ask again.
            <RetryButton />
          ) : (
            <Link
              className="inline-block rounded-input bg-accent px-4 py-2 text-accent-on"
              href="/"
            >
              Về trang chính
            </Link>
          ))}
      </div>
    </main>
  );
}
