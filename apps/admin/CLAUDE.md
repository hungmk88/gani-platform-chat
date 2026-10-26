# apps/admin — UI Admin & Agent Inbox

Nguồn chính: **Brief UI v1.0** (12/10/2026) + Phụ lục B (ma trận quyền). Về API, FSM, quyền,
Brief Backend & Core v1.0 thắng Brief UI. Khi mâu thuẫn → ghi vào `QUESTIONS.md`, không tự đoán.

## Phạm vi theo đợt

Dự án có **2 đợt** (Đợt 1 = 58 mã, go-live 15/02/2027; Đợt 2 = 77 mã, 3 cổng). Căn cứ: file
"Phạm vi triển khai — 135 mã". Mã không có trong file thì ngoài phạm vi.

- Màn Đợt 2 được ẩn bằng feature flag ở Đợt 1; không hiện rồi báo "không có quyền".
- Không làm ở Đợt 1–2: dark mode, tiếng nước ngoài, Customer Portal, nhiều tab Inbox (dùng `J`/`K`).

## Menu (5 nhóm cố định, không thêm; tối đa 2 cấp)

1. Hộp thư — `/inbox`
2. Khách hàng — `/customers`, `/leads`, `/tickets`; `/quotes`, `/orders` (Đợt 2)
3. Tự động hóa — `/bots`; `/automation`, `/knowledge` (Đợt 2)
4. Tổng quan & Báo cáo — `/overview`; `/reports` (Đợt 2)
5. Cài đặt — `/settings/{workspace, members, teams, channels, quick-replies, customer-data, ai, autonomy, audit, security}`;
   `/settings/widget` (Đợt 2). `quick-replies` (#22) cho Owner/Admin/Manager (Phụ lục B, N163); `teams` (#20) thêm Manager
   chỉ đọc team của mình (U39); còn lại Owner/Admin (`customer-data` #23 chỉ Owner/Admin, U36).

`/platform` chỉ hiện với `platform_operator`. Ẩn mục theo vai trò và theo đợt.

Mục menu chưa có màn (đa số chờ API) hiện "<mục>: màn này chưa có trong bản hiện tại." + một link tới màn đã có (Hộp thư, hoặc Hồ sơ cá nhân cho vai trò không giữ hội thoại), không phải 404: `src/pending-page.tsx`, `menuItemAt`. Đường dẫn ngoài menu của vai trò vẫn là 404 trong khung.

Trang mặc định sau đăng nhập:
- Owner/Admin/Manager → `/overview`
- Sales/Support → `/inbox`
- Marketing/Viewer → `/overview` (Đợt 2: Marketing → `/reports`)
- platform_operator → `/platform`

## Nguyên tắc thẩm mỹ (Brief UI §1.2, §2.1)

- Mỗi màn **1 nút chính**; thao tác hằng ngày ≤ 2 click hoặc 1 phím tắt. Bước phụ trong hộp
  thoại (chọn lý do Chuyển, chọn kết quả Đóng) tính là 1 click của hộp thoại (CEO chốt).
- Nền trung tính + 1 màu nhấn. Xanh/vàng/đỏ **chỉ** cho trạng thái. Ghi chú nội bộ dùng `--color-note`.
- Font Inter (tự host), tối đa 4 cỡ: 12/14/16/20px (Admin 14). Lưới 4/8px. Bo góc 4/8/12.
  Chuyển động ≤ 200ms, chỉ để phản hồi.
- Mỗi màn đủ 4 trạng thái: Đang tải · Trống · Lỗi (kèm `traceId` + Thử lại) · AI tắt. Màn không có
  phần AI ghi "Không áp dụng AI" có chủ đích. Mỗi trạng thái trống/lỗi có 1 câu + 1 hành động.
- Nhãn lời đời thường, **không** hiện `HUMAN_WAITING_Q`, `Error 500`.

## State & realtime

- TanStack Query cho server state, Zustand cho UI state, Socket.IO client (`resume { lastSequenceNumber }`).
- Gửi tin, tag, ghi chú: cập nhật lạc quan. Nhận, chuyển, đóng, gộp khách, đổi quyền, xuất bản
  flow, đổi bước lead: **chờ máy chủ** (khóa nút). Mọi POST tạo dữ liệu mang `Idempotency-Key`.
- Xử lý mã lỗi theo bảng P9 (Brief Backend) / Brief UI §2.5.
- Hạn link mời và các hằng số nghiệp vụ lấy từ API, không ghi cứng (link mời: 7 ngày theo Backend).

## Bảo mật giao diện (Brief UI §2.6)

- Nội dung khách gửi luôn là **chữ thuần** (Inbox, hồ sơ, thông báo đẩy, tiêu đề tab); không render
  HTML/markdown; link không tự xem trước.
- Khóa cache gồm `orgId` + `workspaceId`; đổi workspace hoặc đăng xuất → xóa cache + ngắt realtime.
- Client không tự vào room Socket.IO theo id. File chỉ qua link ký 15 phút.
- Bản nháp lưu server (`/v1/me/drafts`), không `localStorage`.
- 2FA bắt buộc: Owner, Admin, platform_operator.
- CI bắt buộc T1 (đổi workspace), T2 (nội dung độc), T3 (room realtime), axe-core, lint token.

## Cấm

- Không dùng màu/cỡ chữ ngoài `packages/ui/tokens` (lint chặn).
- Không thêm nhóm menu thứ 6.

## Kiểm chứng

- Admin tải nội dung chính < 2,5 giây; mở khung hội thoại P95 < 500ms; danh sách 500+ hội thoại ảo hóa.
- 4 thao tác chính (nhận, trả lời, chuyển, đóng) ≤ 2 click hoặc 1 phím tắt.
- Tương phản WCAG 2.1 AA trên 100% màn.

## Chạy (F2)

- Next.js 16 (App Router) + React 19 + Tailwind 4 (`@gani/ui/theme.css`, chỉ class theo token). Font Inter tự host (`@fontsource-variable/inter`).
- `pnpm --filter @gani/admin dev` → cổng 3001. `/api/auth/*` và `/v1/*` được chuyển tiếp sang `API_ORIGIN` (mặc định `http://localhost:3000`):
  admin và API chung một địa chỉ gốc (`BETTER_AUTH_URL`, N136), production do reverse proxy làm.
- Khung app lấy người dùng từ `GET /v1/me` (U32, N145; kiểu `Me` sinh từ OpenAPI, `src/me.ts`): lỗi thì hiện trang lỗi, không có vai trò giả trong mã.
  `org: null` mà không phải platform operator (không thuộc công ty nào, hay thuộc nhiều công ty mà chưa chọn) → trang "không có quyền"; màn chọn công ty chờ danh sách công ty (N145 còn mở).
- `next build` hỏng ("reading 'useContext'") nếu `NODE_ENV=development` đặt sẵn trong môi trường: bỏ biến đó khi build. CI không đặt.
- `typecheck` = `next typegen && tsc --noEmit` (`next-env.d.ts` do Next sinh, không commit).
- Import trong app không có đuôi `.js` (bundler), khác `apps/api`.
- Đăng nhập thật khi dev: API chạy với `BETTER_AUTH_URL=http://localhost:3001` (địa chỉ của admin), vì cookie phiên và kiểm `Origin` (N136) theo địa chỉ trình duyệt thấy. Khung app hỏi `GET /v1/me/security-status` trước (401 → `/login`, phải cài 2FA → `/two-factor/setup`), rồi mới `GET /v1/me`.

## E2E và axe (F4)

- `apps/admin/e2e/*.spec.ts`, Playwright + `@axe-core/playwright` (WCAG 2.1 A/AA, 0 vi phạm trên mọi màn mở ra). CI: job `admin (e2e, axe)`.
- Chạy bản build thật với API giả `e2e/stub-api.ts` (chỉ cho test, không triển khai): mỗi email là một tình huống: `<vai trò>@e2e.test` vào thẳng, `+2fa` hỏi mã, `+setup` phải cài 2FA, `+gate` bị `/v1/me` trả 403 `two_factor_setup_required`, `+status-down` (security-status 503), `+inbox-empty`, `+inbox-down` (danh sách hội thoại trống / lỗi 500), `+claimed` (nhận trượt), `+stale` (`version_conflict`), `+many` (600 hội thoại chờ, trang 200), `+window` (gửi tin bị 422 `channel_window_closed`), `+multi` (2 workspace, T1); token trong `INVITES` mở trang `/invite`, trong `RESETS` mở `/reset-password` (`e2e/stub-links.ts`); mời thành viên: `da-moi@` (409 đã có lời mời), `khong-gui@` (`emailSent: false`). Thao tác trên hội thoại sửa bản sao riêng của phiên. API giả có cả Socket.IO `/agent` (kiểm `Origin` + cookie như API); test điều khiển nó qua `POST /__e2e/{message,state,drop,end}` với `sid` là cookie phiên của chính test. Mỗi lần đăng nhập là một phiên riêng, test chạy song song không chung trạng thái.
  API giả theo dạng Better Auth và `src/auth.ts`, `src/me.ts`; `GET /v1/me` trả đúng kiểu `Me` của OpenAPI (typecheck bắt lệch).
- Chạy: `env -u NODE_ENV pnpm --filter @gani/admin build`, rồi `pnpm --filter @gani/admin e2e`. API giả chiếm cổng 3000, admin cổng 3001: tắt API và admin đang chạy trước.
  Chromium: `pnpm --filter @gani/admin exec playwright install chromium` một lần, hoặc `CHROMIUM_PATH=<đường dẫn>` tới Chromium có sẵn.
- Ngân sách "Kiểm chứng" (`e2e/perf.spec.ts`, đồng hồ của trình duyệt, bản build + API giả): Hộp thư hiện nội dung chính < 2,5 giây; mở hội thoại từ danh sách P95 < 500ms (21 lần). Bắt phần FE thêm vào (bundle, render, gọi nối tiếp), không đo API thật. Đo khi viết: tải 270–700ms, mở P95 180–260ms.
- `pnpm test` không chạy E2E (chỉ Vitest, `src/**/*.test.ts`).

## Nhận lời mời (#4, N151)

- `/invite` nằm ngoài nhóm `(app)`, mở cho người chưa có tài khoản. Link email là `BETTER_AUTH_URL/invite#token=…` (N152): token ở fragment, trang đọc rồi **xóa khỏi thanh địa chỉ** ngay (`history.replaceState`), chỉ giữ trong bộ nhớ.
- `POST /api/auth/invite/lookup` → email được mời + vai trò; `GET /v1/me/security-status` 200 nghĩa là đang đăng nhập: chỉ nút "Tham gia". Chưa đăng nhập: họ tên (tùy chọn), mật khẩu + nhập lại, kiểm như API (ADR-003, `src/invite.ts`), rồi `POST /api/auth/invite/accept` mở phiên. Xong thì về `/`: khung app đưa Owner/Admin sang cài 2FA.
- Mọi từ chối token là một câu "Link không hợp lệ hoặc đã hết hạn." + link tới `/login` (không phân biệt lý do); 429 → đợi 1 phút. Tên công ty, người mời: API lookup chưa trả (N151).

## Quên mật khẩu (PR7, N162)

- `/forgot-password` và `/reset-password` nằm ngoài nhóm `(app)`, như `/invite`; trang đăng nhập có link "Quên mật khẩu?". Hai đường của plugin Better Auth (không có trong OpenAPI): `POST /api/auth/password/forgot {email}` **luôn 202** → một câu như nhau dù email có tài khoản hay không (`src/password-reset.ts` + `forgot-form.tsx`); 400 `INVALID_EMAIL` → "Email chưa đúng dạng."; 429 → đợi 1 phút.
- Link email `BETTER_AUTH_URL/reset-password#token=…`: token ở fragment, đọc rồi **xóa khỏi thanh địa chỉ** ngay, chỉ giữ trong bộ nhớ (`tokenOf` của `src/invite.ts`). Mật khẩu mới + nhập lại kiểm như API (ADR-003, `isStrongPassword`), rồi `POST /api/auth/password/reset {token, password}` (`reset-form.tsx`). Xong: API thu hồi mọi phiên và **không** tạo phiên → câu "Đăng nhập lại" + link `/login`. Mọi từ chối token (404 `RESET_INVALID`) là một câu + link "Xin link mới"; 400 `PASSWORD_TOO_WEAK` nói quy tắc. Hạn link không ghi cứng (email ghi hạn).
- API giả: `e2e/stub-links.ts` (`RESETS`, `NOT_AN_EMAIL`; cùng file với `INVITES` của #4).

## Gọi API (F5b)

- `src/api/client.ts` → `api<T>(path, req)`: cùng địa chỉ gốc, kèm cookie phiên; trả `{ok, data}` hoặc `{ok: false, error}`. Mọi POST mang `Idempotency-Key`:
  truyền `idempotencyKey` (một khóa cho một thao tác, giữ nguyên khi người dùng bấm lại); lỗi `wait` (429, `idempotency_in_progress`) tự thử lại một lần theo `Retry-After` ≤ 10 giây.
- `src/api/errors.ts`: bảng mã lỗi P9 (+ mã API đang trả: `two_factor_setup_required`, `invalid_assignee`, `idempotency_*`, `forbidden_origin`), mỗi mã một câu và một hành động. Mã lạ → theo HTTP status.
- Kiểu: `components['schemas'][...]` trong `src/api/schema.d.ts`, sinh bằng `pnpm --filter @gani/admin gen:api` từ `docs/openapi/openapi.json` (không sửa tay, không lint/format). Backend đổi OpenAPI thì chạy lại; CI đỏ nếu lệch.
- Server state: `useApiQuery<T>(parts, path)` (`src/query/provider.tsx`), khóa luôn là `['org', orgId, 'ws', workspaceId, ...parts]` (`src/query/keys.ts`).
  `QueryProvider` gắn `key={scopeId(scope)}` trong khung app: đổi công ty/workspace là cache mới; đăng xuất xóa cache. Lỗi `sign_in`/`set_up_2fa` của mọi query tự chuyển trang.
  Workspace đang làm (T1): chọn ở thanh trên (`src/workspace-switcher.tsx`, chỉ hiện khi có từ 2 workspace), lưu cookie `gani_ws` (không phải bí mật); khung app đọc trên server và chỉ nhận id thuộc `me.workspaces`, không có thì lấy workspace đầu (`pickWorkspace`). Đổi là `router.refresh` → scope mới → `QueryProvider` dựng lại: cache cũ bỏ, realtime ngắt rồi nối lại. Hộp thư gửi `workspaceId` khi đọc danh sách. E2E `+multi` (2 workspace).

## Hộp thư (#6)

- `/inbox` (I1a): cột danh sách. Bộ lọc nằm trên URL (`?assignee=me|none&state=…|hold`), trang theo cursor ("Tải thêm"). Vai trò đọc được: owner, admin, manager, sales, support (như `permissions.ts` của API); vai trò khác → trang 403.
- Danh sách **ảo hóa** theo cuộn của trang (`@tanstack/react-virtual`, `useWindowVirtualizer`): chỉ các dòng gần màn hình nằm trong DOM, mỗi dòng đo khi vẽ; `aria-setsize`/`aria-posinset` cho trình đọc màn hình. E2E `+many` kiểm 600 dòng: DOM dưới 100 dòng, cuộn tới dòng cuối.
- Dòng chỉ hiện trường API có: **tên khách** (`customer.displayName`, N165; chưa gắn khách hoặc chưa có tên thì "Khách chưa có tên", `customerNameOf`; CEO duyệt 26/10), trạng thái (nhãn lời thường), "Tôi" / "Người khác" / "Chưa ai nhận", giờ tin cuối (giờ Việt Nam). Kênh, đoạn trích, tag, SLA chờ phần còn lại của U30; không bịa dữ liệu (CEO chọn A, 21/10). Đầu hội thoại đang mở cũng có tên khách và link "Xem hồ sơ khách" (`/customers/{id}`, #8) khi hội thoại đã gắn khách.
- `assignedUserId`, `senderUserId` trong kiểu sinh là `string | null` (U34, OpenAPI `type: [string, null]`): không cần ép kiểu.
- `/inbox/[id]` (I1b): danh sách bên trái, hội thoại bên phải (`inbox/layout.tsx` kiểm vai trò một lần). Tin xếp theo `platformSentAt` rồi `sequenceNumber` (P10); "Tải tin cũ hơn" theo cursor. Nội dung khách là chữ thuần (React escape, không HTML/markdown, T2 có E2E). Hội thoại không được xem và không tồn tại cùng một câu "Không tìm thấy" (404, P9).
- Phím J/K: hội thoại kế tiếp / trước trong danh sách đã tải, giữ bộ lọc; `?` mở bảng phím tắt (`src/inbox/keys.ts` + `inbox-keys.tsx`, đọc cùng cache với cột danh sách). Bảng chỉ ghi phím đang chạy; T, N, / chờ U31, ghi chú, tìm kiếm.
- Thao tác (I1c): Nhận (phím A), Chờ khách, Đóng (phím E, hộp thoại chọn kết quả). Nút chỉ hiện khi API cho phép (`src/inbox/actions.ts`, cùng luật `permissions.ts` + FSM P14); chờ máy chủ, khóa nút, mỗi lần bấm một `Idempotency-Key` mới. Nhận trượt (409 `conversation_already_claimed`): hiện người đang giữ theo `assignedUserId` của 409, không đọc lại hội thoại (sales/support không còn được xem).
- "Phụ trách" của hội thoại đang mở: Owner/Admin thấy **tên** người giữ (từ `GET /v1/members`, `src/inbox/holder.tsx`); vai trò khác vẫn "Tôi" / "Người khác" / "Chưa ai nhận" (U30).
- Gán lại (Phụ lục B dòng 16, `POST …/assign`): `src/inbox/assign.ts` + `assign-action.tsx`. Danh sách người nhận hợp lệ là U31 (mở): tạm thời chỉ **Owner/Admin** có nút, chọn từ `GET /v1/members` (thành viên đang hoạt động, vai trò giữ được hội thoại, trừ người đang giữ); Manager được gán theo API nhưng chưa đọc được danh sách nên chưa có nút. Chỉ hiện người thuộc workspace của hội thoại (`GET /v1/workspaces/{id}/members`, N159); đọc không được thì hiện mọi thành viên, API trả 422 `invalid_assignee` thì nói câu P9. Hội thoại đang giữ hoặc đang chờ (T16, T21); chờ máy chủ, một `Idempotency-Key` cho một người được chọn. Chuyển (`transfer`, sales/support cùng team) vẫn chờ U31.
- Trả lời khách (I2, N146): `src/inbox/reply-box.tsx` + `composer.ts`. Ô soạn chỉ hiện khi có người giữ hội thoại (`HUMAN_ACTIVE`, `PENDING_CUSTOMER`); owner/admin/manager mọi hội thoại thấy được, sales/support chỉ hội thoại mình giữ. Gửi **lạc quan**: tin hiện ngay ("Đang gửi…", id `local-…`), câu trả lời của API thay vào ("Chờ gửi" theo `deliveryStatus`), bị từ chối thì gỡ tin và trả chữ về ô. Một `Idempotency-Key` cho một nội dung: gửi lại đúng chữ đó sau lỗi dùng lại khóa, chữ khác thì khóa mới. 422 `channel_window_closed` nói lý do theo `reason`; 409 `conversation_not_active` tải lại hội thoại. Ctrl/⌘+Enter gửi, phím R vào ô. Bản nháp chưa lưu server (`/v1/me/drafts` chưa có), không dùng `localStorage`.
- Mẫu trả lời trong Hộp thư (C7c, N163): ô trả lời chỉ chứa `/` + đầu phím tắt (`slashQuery`) → danh sách mẫu của **workspace của hội thoại** (`GET /v1/quick-replies?workspaceId=&q=`, chỉ hỏi khi danh sách mở, tối đa 8, dùng nhiều trước), ↑/↓ chọn, Enter/Tab hoặc bấm là chèn, Esc đóng (`src/inbox/templates.ts` + `template-picker.tsx`). Chèn thì điền sẵn biến FE biết (`knownOf`: `agent_name` = tên trong `/v1/me`, `company_name` = tên công ty; `company_phone` = `contactPhone` của workspace của hội thoại trong `GET /v1/me` `workspaces[]`, mọi vai trò, N164, `phonesOf` + `phoneOf`; `customer_name` = `customer.displayName` của hội thoại, N165, U37, `customerOf`); biến còn lại (`customer_name` khi hội thoại chưa gắn khách hoặc chưa biết tên, `company_phone` khi workspace chưa đặt số) có ô điền dưới ô soạn, thay khi gửi (`fill`). Còn `{{…}}` thì không gửi, nói phải điền gì (`unresolvedProblem`); API trả 422 `unresolved_variable` thì nói câu P9. Gửi xong tin từ mẫu → `POST /v1/quick-replies/{id}/used` (chỉ đếm, lỗi không hiện), rồi đọc lại danh sách mẫu. Xóa hết chữ là bỏ mẫu, tin tự gõ không đếm.
- Realtime (I1b-2): một kết nối Socket.IO `/agent` cho khung app (`src/realtime/realtime.tsx`), chỉ với vai trò đọc hội thoại; nằm trong `QueryProvider` nên đổi công ty/workspace hay đăng xuất là ngắt. `state_changed`/`assigned`/`message.created` sửa cache (`src/realtime/events.ts`: không thay bản mới bằng bản cũ). Hội thoại đang mở: `conversation.subscribe`, nối lại thì `resume` từ số tin lớn nhất (`use-conversation-realtime.ts`). Client chỉ gửi `conversationId`, không bao giờ tên phòng (T3, E2E). `session.ended` → `/login`.
- `next start` **không** chuyển tiếp WebSocket (đã thử). Production: admin và API chung địa chỉ gốc sau reverse proxy, `REALTIME_ORIGIN` để trống. Dev/E2E: `REALTIME_ORIGIN=http://localhost:3000` (đọc lúc chạy, không cần build lại); cookie vẫn đi vì cùng tên máy, `Origin` vẫn là địa chỉ admin.

## Khách hàng (#7, #8)

- `/customers`, mọi vai trò của công ty (Phụ lục B; `mayReadCustomers`), platform operator trang 403 (phiên hỗ trợ ở #30, sau). Khách cấp **công ty**, dùng chung mọi workspace (N165): danh sách không lọc theo workspace đang chọn.
- `GET /v1/customers` (mới nhất trước, cursor, "Tải thêm"): tên (chưa có thì "Khách chưa có tên"), SĐT (E.164 viết lại `0912 345 678`, `phoneText`), email, kênh (từ `identities`, Đợt 1 chỉ Zalo OA), ngày cập nhật (`src/customers/customers.ts` + `customer-list.tsx`).
- Tìm (`q`, cắt khoảng trắng, ≤ 100): một phần tên, hoặc đầu số điện thoại từ 3 số. Marketing/Viewer: API trả SĐT, email **đã che** và chỉ tìm theo tên (`seesMasked`); màn nói vậy dưới ô tìm. Mỗi chữ tìm là một khóa cache.
- Tag, người phụ trách, liên hệ cuối, bộ lọc kênh/tag: chờ API (J4, U47); không bịa cột. Tên khách trên dòng là link tới hồ sơ.
- **Hồ sơ khách (#8)** `/customers/[id]`, cùng vai trò với #7 (`GET /v1/customers/{id}`, `src/customers/customer-profile.tsx`): tên, SĐT, email, kênh, "Chỉ người phục vụ" (`humanOnly`, Brief §28: bot không trả lời khách này), ngày tạo/cập nhật; **Định danh**: mỗi kênh biết khách kèm mức xác thực (`VERIFICATION`: Đã xác thực, Sales xác nhận, Chưa xác thực). Khách không có hoặc của công ty khác: "Không tìm thấy khách" + link về danh sách (404, P9). Hội thoại, lead, ticket, tag, ghi chú: chờ API.
- **Sửa hồ sơ** (`PATCH /v1/customers/{id}`): nút "Sửa hồ sơ" cho Owner/Admin/Manager/Sales/Support (`mayEditCustomers`, Phụ lục B; Marketing/Viewer không có nút), hộp thoại tên (≤ 200), SĐT, email, "Chỉ người phục vụ" (`src/customers/customer-edit.ts` + `customer-edit-dialog.tsx`). Kiểm như API trước khi gửi: SĐT viết cách thường gặp, chuyển E.164 như `toE164` của `@gani/domain`; email chữ thường. Chỉ gửi trường đổi thật (`changeOf`), ô để trống là `null` (xóa); không đổi gì thì đóng, không gọi API. Chờ máy chủ, không `Idempotency-Key`; xong thì hồ sơ lấy câu trả lời, danh sách đọc lại. API giả: `e2e/stub-customers.ts` (`CUSTOMERS`, trang 3 dòng; `/{id}`; `PATCH` sửa bản sao của phiên).

## Hồ sơ cá nhân (#5)

- `/me` (mọi vai trò; tên ở thanh trên là link): 3 phần theo URL `?tab=info|security|notify` (link, không phải tablist).
- Thông tin: đọc từ `/v1/me` (tên, vai trò, công ty, workspace). **Đổi tên** (`PATCH /v1/me {name}`, N162): 1–100 ký tự, cắt khoảng trắng như API (`src/profile/name.ts` + `name-form.tsx`); nút khóa khi tên chưa đổi; chờ máy chủ, không `Idempotency-Key`; xong thì khung app đọc lại (`router.refresh`, thanh trên có tên mới). Ảnh đại diện: để sau khi có kho file (N162).
- Bảo mật: trạng thái 2FA (`security-status`, không có nút tắt); đổi mật khẩu qua `POST /api/auth/change-password`: API **luôn** đăng xuất các thiết bị khác (N162), nên form không có ô chọn, chỉ nói trước; vẫn gửi `revokeOtherSessions: true`. 429 (5 lần/phút) → đợi 1 phút. Better Auth chỉ kiểm độ dài 12–128, nên form kiểm thêm chữ + số (ADR-003) trước khi gửi (`src/profile/password.ts`). "Đăng xuất khỏi các thiết bị khác" = `POST /api/auth/revoke-other-sessions`.
- **Không gọi `/api/auth/list-sessions`**: đường này trả token của mọi phiên cho JavaScript (giữ cho `/revoke-session`, SEC-03). Danh sách phiên của prototype #5 chờ một đường không có token.
- Thông báo: chờ API.

## Workspace (#21)

- `/settings/workspace`, chỉ Owner và Admin như API (N157; Manager không vào, CEO chốt 26/10, U39) → vai trò khác trang 403. `GET /v1/workspaces` (theo tên, không cursor): bảng tên + mã, mẫu (lời thường), múi giờ, giới hạn tải mặc định (`src/workspaces/workspace.ts` + `workspace-table.tsx`).
- **Sửa** (`PATCH /v1/workspaces/{id}`): hộp thoại tên (1–100, cắt khoảng trắng như API), múi giờ (danh sách IANA của trình duyệt, `Intl.supportedValuesOf`), giới hạn tải mặc định 1–100 (C9), **SĐT liên hệ** (`contactPhone`, thay cho `{{company_phone}}` của mẫu trả lời nhanh, N163; chữ số, `+` đầu, khoảng trắng, chấm, gạch, 6–20 ký tự như API; để trống là `null`, xóa số; bảng có cột "SĐT liên hệ", chưa có thì "Chưa đặt"). Chỉ gửi trường đổi thật (`changeOf`); không đổi gì thì đóng, không gọi API (API trả 400 cho body rỗng). Chờ máy chủ, không `Idempotency-Key`; xong thì bảng lấy câu trả lời và khung app đọc lại (`router.refresh`, thanh trên có tên workspace). Mẫu và mã chọn lúc tạo (spec-M8 A2), không sửa.
- **Người trong workspace** (`GET/PUT /v1/workspaces/{id}/members`, N159): nút "Người" trên dòng, hộp thoại ô chọn cho mọi thành viên đã có tài khoản (active/suspended, không lời mời; đọc hết các trang `GET /v1/members`, tối đa 500), người của workspace đã tích sẵn (`src/workspaces/workspace-members.ts` + `members-dialog.tsx`). Lưu = PUT cả danh sách, chờ máy chủ, không `Idempotency-Key`; không đổi gì thì đóng, không gọi API (`samePeople`). Có hiệu lực từ request kế tiếp của mỗi người. 400 `validation_failed` (có người không còn là thành viên) → tải lại rồi chọn lại.
- Giờ làm việc, ngày nghỉ, SLA, cách phân bổ (prototype #21, spec-M8 §3.3–3.5): chờ API. API giả: `e2e/stub-workspaces.ts` (mỗi phiên một bản sao).

## Team (#20)

- `/settings/teams`, Owner và Admin quản lý (Phụ lục B). **Manager chỉ đọc** team mình thuộc về (API trả đúng những team đó, N160; CEO chốt 26/10, U39): không form tạo, không cột thao tác (`TeamsScreen readOnly`), trống thì "Bạn chưa thuộc team nào…". Vai trò khác trang 403. Team của **workspace đang chọn** ở thanh trên (`useScope().workspaceId`, T1).
- Danh sách `GET /v1/teams?workspaceId=` (A4, N160; theo tên): tên + mã, nhãn "Mặc định", mô tả, số người (`src/teams/teams.ts` + `team-list.tsx`).
- **Tạo team** (`POST /v1/teams`): tên 1–100, mô tả tối đa 500 (không bắt buộc, trống là không có), cắt khoảng trắng như API (`teamDraftOf`). Chờ máy chủ, một `Idempotency-Key` cho một cặp tên + mô tả; xong thì team vào danh sách theo tên (`withTeam`). Mã (slug) do API sinh.
- **Sửa** (`PATCH /v1/teams/{id}`, A4-T2b): hộp thoại tên, mô tả (xóa trắng là bỏ mô tả), "Team mặc định của workspace" (`src/teams/team-dialogs.tsx`). Chỉ gửi trường đổi thật (`teamChangeOf`); không đổi gì thì đóng, không gọi API. Chỉ **đặt** mặc định, không bỏ: team mặc định thì ô bị khóa (đặt team khác làm mặc định để đổi), workspace luôn còn một; xong thì cờ chuyển sang team mới trong danh sách (`withChanged`). Chờ máy chủ, không `Idempotency-Key`.
- **Kết thúc** (`DELETE /v1/teams/{id}`): hộp thoại hỏi lại (số người rời team), chờ máy chủ; xong thì team ra khỏi danh sách (`withoutTeam`). Team mặc định không có nút này; 409 `team_in_use` (team mặc định, hoặc team còn trả lời kênh, N161) nói phải đặt team khác làm mặc định hoặc bỏ kênh của team trước.
- **Người của team** (`GET/PUT /v1/teams/{id}/members`, A4-T2c, N160): nút "Người" trên dòng, hộp thoại ô chọn cho **người của workspace của team** (`GET /v1/workspaces/{id}/members`, N159; tên lấy từ `GET /v1/members`, `inWorkspace`), người của team đã tích sẵn (`src/teams/team-members.ts` + `team-members-dialog.tsx`). Lưu = PUT cả danh sách, chờ máy chủ, không `Idempotency-Key`; không đổi gì thì đóng, không gọi API (`samePeople`); xong thì cột "Số người" lấy số của câu trả lời (`withCount`). 400 `validation_failed` (có người không còn thuộc workspace) → tải lại rồi chọn lại.
- **Kênh của team** (`GET /v1/channels?workspaceId=` + `PUT /v1/teams/{id}/channels`, A4-T3, N161): nút "Kênh" trên dòng team **không mặc định** (kênh không giao team nào đã về team mặc định), hộp thoại ô chọn mọi kênh của workspace: tên, loại, trạng thái kết nối (lời thường), team đang trả lời nếu không phải team này (`answeredBy`); kênh của team đã tích sẵn (`src/teams/team-channels.ts` + `team-channels-dialog.tsx`). Lưu = PUT cả danh sách: chọn kênh của team khác là chuyển sang, bỏ chọn là về team mặc định (`withAssigned`); không đổi gì thì đóng, không gọi API (`sameChannels`). Chờ máy chủ, không `Idempotency-Key`; cùng khóa cache `['channels', workspaceId]` với màn Kênh (#24). Kết nối kênh: chờ U26.
- API giả: `e2e/stub-teams.ts` (mỗi phiên một bản sao, `teamsOf`; Manager thuộc team CSKH, `MANAGER_TEAMS`; người của workspace theo `peopleOf` của `e2e/stub-workspaces.ts`), `e2e/stub-channels.ts` (`CHANNELS`).

## Kênh (#24)

- `/settings/channels`, Owner và Admin như menu và API (Phụ lục B). Kênh của **workspace đang chọn** (`GET /v1/channels?workspaceId=`, N161; theo tên): tên, loại (Zalo OA/Facebook/Webchat), trạng thái kết nối bằng lời thường kèm màu trạng thái (xanh/vàng/đỏ), team trả lời (tên từ `GET /v1/teams`; `null` là "Team mặc định") (`src/channels/channels.ts` + `channel-table.tsx`). Chỉ đọc; giao kênh cho team ở `/settings/teams` (nút "Kênh").
- Kết nối Zalo OA, làm mới token, ngắt kết nối, lỗi gần nhất và hạn token: chờ U26; `/settings/channels/[id]` (#25) cũng chờ U26. API giả: `e2e/stub-channels.ts` (`CHANNELS`).

## Mẫu trả lời nhanh (#22)

- `/settings/quick-replies`, Owner/Admin/Manager như menu (Phụ lục B "Quản lý mẫu trả lời nhanh", N163; `mayManageQuickReplies`); Sales/Support chỉ dùng mẫu trong Hộp thư (API cho đọc) → trang 403. Mẫu của **workspace đang chọn** (`GET /v1/quick-replies?workspaceId=&q=&tag=`), dùng nhiều nhất trước (API sắp xếp): `/phím tắt`, nội dung là chữ thuần (giữ xuống dòng), tag, số lần dùng (`src/quick-replies/quick-replies.ts` + `quick-reply-list.tsx`).
- Tìm theo **đầu phím tắt** (`q`, cắt khoảng trắng, chữ thường, tối đa 32); bấm một tag của dòng là lọc theo tag đó (`tag`), bấm lại hoặc "Bỏ lọc tag" là bỏ. Mỗi bộ lọc là một khóa cache.
- **Tạo mẫu** (`POST /v1/quick-replies`, C7b1): phím tắt (chữ thường không dấu, số, `-`, `_`, 1–32; ô tự chuyển chữ thường, bỏ "/" đầu), nội dung (không trống, tối đa 2000), tag (dấu phẩy, cắt khoảng trắng, bỏ trùng, ≤ 10, mỗi tag ≤ 30). Kiểm như API trước khi gửi (`quickReplyDraftOf`): biến chỉ 4 biến Đợt 1 (`VARIABLES`), chèn bằng nút "Chèn biến" tại con trỏ; biến lạ báo ngay. Chờ máy chủ, một `Idempotency-Key` cho một mẫu (giữ khi gửi lại đúng mẫu đó sau lỗi); xong thì đọc lại mọi danh sách của workspace (API sắp theo số lần dùng). 409 `duplicate_resource` → phím tắt đã có (`src/quick-replies/quick-reply-form.tsx`).
- **Sửa** (`PATCH /v1/quick-replies/{id}`, C7b2): hộp thoại phím tắt, nội dung (cùng nút "Chèn biến", `variable-buttons.tsx`), tag; kiểm như khi tạo, chỉ gửi trường đổi thật (`quickReplyChangeOf`, tag so theo thứ tự; xóa hết tag là `[]`), không đổi gì thì đóng, không gọi API. Chờ máy chủ, không `Idempotency-Key`. **Xóa** (`DELETE`): hộp thoại hỏi lại, phím tắt dùng lại được. Xong cả hai thì đọc lại mọi danh sách của workspace (`src/quick-replies/quick-reply-dialogs.tsx`).
- **Xem trước** (`POST /v1/quick-replies/{id}/preview`, C7c3): nút trên dòng, hộp thoại chỉ đọc. Hiện nội dung với dữ liệu mẫu của API (khách mẫu, tên người xem, tên công ty, SĐT liên hệ của workspace), chữ thuần. Biến API không điền được (`unresolved`) được nói bằng lời và chỉ chỗ đặt giá trị (`missingOf`). Bản đang soạn (U38): nút "Xem trước" trong form tạo và hộp thoại sửa (khóa khi nội dung trống) gửi `POST /v1/quick-replies/preview {workspaceId, body}` (không ghi gì, biến lạ là 400); cùng hộp thoại (`PreviewQuickReplyDialog source={{kind: 'draft'}}`), khóa cache theo nội dung. Khóa cache nằm dưới `['quick-replies', workspaceId]` kèm `updatedAt`, nên sửa mẫu là đọc lại (`src/quick-replies/quick-reply-preview.tsx`). Dùng mẫu trong Hộp thư: xem "Mẫu trả lời trong Hộp thư" ở mục Hộp thư. API giả: `e2e/stub-quick-replies.ts` (`QUICK_REPLIES`, mỗi phiên một bản sao).

## Thành viên (#19)

- `/settings/members`, chỉ Owner và Admin (vai trò khác → trang 403): **Mời thành viên** (`POST /v1/members/invite`, N152; `src/members/invite.ts` + `invite-form.tsx`), rồi **Danh sách** (`GET /v1/members`, N153; `src/members/list.ts` + `member-list.tsx`).
- Vai trò mời được theo Phụ lục B như `members.permissions.ts` của API: Owner mọi vai trò, Admin mọi vai trò trừ Owner. Email gửi đi đã cắt khoảng trắng, chữ thường (như API lưu).
- Chờ máy chủ (tạo thành viên), không lạc quan. Một `Idempotency-Key` cho một cặp email + vai trò: bấm lại sau lỗi dùng lại khóa, API trả câu cũ và không gửi email lần hai.
- Hạn link lấy từ `expiresAt` của API (U1, không ghi cứng 7 ngày). `emailSent: false` → nói lời mời đã tạo nhưng email chưa đi. 409 `duplicate_resource` → "Email này đang có lời mời chờ nhận."
- Email chưa đi (`emailSent: false`) → nút phụ **Gửi lại lời mời** (`POST /v1/members/{id}/resend-invite`, id của câu trả lời vừa nhận): một khóa cho một lời mời tới khi thành công; link mới, hạn mới theo API, link cũ hết dùng. 404 → "Lời mời này không còn chờ nhận".
- Danh sách: thành viên và lời mời, cũ trước, "Tải thêm" theo cursor; tên (hoặc "Chưa nhận lời mời") + email, vai trò, 2FA ("Bắt buộc, chưa cài" cho Owner/Admin chưa bật), trạng thái (`active`/`suspended`/`pending`/`expired`, kèm hạn của lời mời chờ). Lời mời chờ hoặc hết hạn có nút **Gửi lại lời mời** trên dòng nếu người xem được mời vai trò đó (Admin không gửi lại lời mời Owner); xong thì dòng sửa theo câu trả lời (`withRenewed`). Mời hay gửi lại từ form thì đọc lại danh sách.
- **Đổi vai trò** (`PATCH /v1/members/{id}/role`, N154): nút trên dòng thành viên (không phải lời mời), mở hộp thoại chọn vai trò, chờ máy chủ; xong thì dòng lấy câu trả lời của API (`withMember`). Không ai đổi vai trò của chính mình; Admin không sửa Owner và không chọn được Owner (`canChangeRole`). Không có `Idempotency-Key` (PATCH, N154). 409 `last_owner` → "Công ty phải còn ít nhất một Owner đang hoạt động."
- **Đặt lại 2FA** (`POST /v1/members/{id}/2fa/reset`, Q-U20-1, N155): nút "Đặt lại 2FA…" trên dòng thành viên đã bật 2FA, cùng luật với đổi vai trò (không ai tự đặt lại của mình; Admin không đặt lại của Owner, `canResetTwoFactor`). Hộp thoại bắt buộc lý do 1–500 ký tự (lưu audit, `reasonProblem`), chờ máy chủ, một `Idempotency-Key` cho một lý do; xong thì dòng lấy câu trả lời (2FA "Chưa bật"), mọi phiên của người đó bị thu hồi. 409 `shared_account` (người còn thuộc công ty khác hoặc là quản trị nền tảng) → nhờ quản trị nền tảng.
- **Giới hạn tải** (`PATCH /v1/members/{id}/capacity`, C9, N156): cột "Giới hạn tải" (số hội thoại giữ cùng lúc, hoặc "Theo mặc định workspace (5)" khi API trả `null`: số là `defaultMaxConcurrent` của workspace đang chọn, từ `GET /v1/workspaces`; không đọc được thì bỏ số) và nút trên dòng mọi thành viên đã có tài khoản, kể cả chính mình và Owner (`canSetCapacity`, không phải quyền bảo mật). Hộp thoại nhận số nguyên 1–100 (`capacityValue`), chờ máy chủ, không có `Idempotency-Key`; xong thì dòng lấy câu trả lời. API chưa cho đưa về mặc định workspace (N156), hộp thoại nói vậy.
- Team, lần đăng nhập cuối: chờ API (N153 "Để sau"). API giả của màn này nằm ở `e2e/stub-members.ts` (`MEMBERS`, trang 4 dòng).
