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
5. Cài đặt — `/settings/{workspace, members, teams, channels, ai, autonomy, audit, security}`;
   `/settings/widget` (Đợt 2)

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
- Chạy bản build thật với API giả `e2e/stub-api.ts` (chỉ cho test, không triển khai): mỗi email là một tình huống: `<vai trò>@e2e.test` vào thẳng, `+2fa` hỏi mã, `+setup` phải cài 2FA, `+gate` bị `/v1/me` trả 403 `two_factor_setup_required`, `+status-down` (security-status 503), `+inbox-empty`, `+inbox-down` (danh sách hội thoại trống / lỗi 500), `+claimed` (nhận trượt), `+stale` (`version_conflict`), `+many` (600 hội thoại chờ, trang 200), `+window` (gửi tin bị 422 `channel_window_closed`); token trong `INVITES` mở trang `/invite`; mời thành viên: `da-moi@` (409 đã có lời mời), `khong-gui@` (`emailSent: false`). Thao tác trên hội thoại sửa bản sao riêng của phiên. API giả có cả Socket.IO `/agent` (kiểm `Origin` + cookie như API); test điều khiển nó qua `POST /__e2e/{message,state,drop,end}` với `sid` là cookie phiên của chính test. Mỗi lần đăng nhập là một phiên riêng, test chạy song song không chung trạng thái.
  API giả theo dạng Better Auth và `src/auth.ts`, `src/me.ts`; `GET /v1/me` trả đúng kiểu `Me` của OpenAPI (typecheck bắt lệch).
- Chạy: `env -u NODE_ENV pnpm --filter @gani/admin build`, rồi `pnpm --filter @gani/admin e2e`. API giả chiếm cổng 3000, admin cổng 3001: tắt API và admin đang chạy trước.
  Chromium: `pnpm --filter @gani/admin exec playwright install chromium` một lần, hoặc `CHROMIUM_PATH=<đường dẫn>` tới Chromium có sẵn.
- `pnpm test` không chạy E2E (chỉ Vitest, `src/**/*.test.ts`).

## Nhận lời mời (#4, N151)

- `/invite` nằm ngoài nhóm `(app)`, mở cho người chưa có tài khoản. Link email là `BETTER_AUTH_URL/invite#token=…` (N152): token ở fragment, trang đọc rồi **xóa khỏi thanh địa chỉ** ngay (`history.replaceState`), chỉ giữ trong bộ nhớ.
- `POST /api/auth/invite/lookup` → email được mời + vai trò; `GET /v1/me/security-status` 200 nghĩa là đang đăng nhập: chỉ nút "Tham gia". Chưa đăng nhập: họ tên (tùy chọn), mật khẩu + nhập lại, kiểm như API (ADR-003, `src/invite.ts`), rồi `POST /api/auth/invite/accept` mở phiên. Xong thì về `/`: khung app đưa Owner/Admin sang cài 2FA.
- Mọi từ chối token là một câu "Link không hợp lệ hoặc đã hết hạn." + link tới `/login` (không phân biệt lý do); 429 → đợi 1 phút. Tên công ty, người mời: API lookup chưa trả (N151).

## Gọi API (F5b)

- `src/api/client.ts` → `api<T>(path, req)`: cùng địa chỉ gốc, kèm cookie phiên; trả `{ok, data}` hoặc `{ok: false, error}`. Mọi POST mang `Idempotency-Key`:
  truyền `idempotencyKey` (một khóa cho một thao tác, giữ nguyên khi người dùng bấm lại); lỗi `wait` (429, `idempotency_in_progress`) tự thử lại một lần theo `Retry-After` ≤ 10 giây.
- `src/api/errors.ts`: bảng mã lỗi P9 (+ mã API đang trả: `two_factor_setup_required`, `invalid_assignee`, `idempotency_*`, `forbidden_origin`), mỗi mã một câu và một hành động. Mã lạ → theo HTTP status.
- Kiểu: `components['schemas'][...]` trong `src/api/schema.d.ts`, sinh bằng `pnpm --filter @gani/admin gen:api` từ `docs/openapi/openapi.json` (không sửa tay, không lint/format). Backend đổi OpenAPI thì chạy lại; CI đỏ nếu lệch.
- Server state: `useApiQuery<T>(parts, path)` (`src/query/provider.tsx`), khóa luôn là `['org', orgId, 'ws', workspaceId, ...parts]` (`src/query/keys.ts`).
  `QueryProvider` gắn `key={scopeId(scope)}` trong khung app: đổi công ty/workspace là cache mới; đăng xuất xóa cache. Lỗi `sign_in`/`set_up_2fa` của mọi query tự chuyển trang.
  `workspaceId` đang `null` tới khi có bộ đổi workspace (`/v1/me` chỉ trả danh sách workspace, chưa có workspace hiện tại).

## Hộp thư (#6)

- `/inbox` (I1a): cột danh sách. Bộ lọc nằm trên URL (`?assignee=me|none&state=…|hold`), trang theo cursor ("Tải thêm"). Vai trò đọc được: owner, admin, manager, sales, support (như `permissions.ts` của API); vai trò khác → trang 403.
- Danh sách **ảo hóa** theo cuộn của trang (`@tanstack/react-virtual`, `useWindowVirtualizer`): chỉ các dòng gần màn hình nằm trong DOM, mỗi dòng đo khi vẽ; `aria-setsize`/`aria-posinset` cho trình đọc màn hình. E2E `+many` kiểm 600 dòng: DOM dưới 100 dòng, cuộn tới dòng cuối.
- Dòng chỉ hiện trường API có: trạng thái (nhãn lời thường), "Tôi" / "Người khác" / "Chưa ai nhận", giờ tin cuối (giờ Việt Nam). Tên khách, kênh, đoạn trích, tag, SLA chờ U30; không bịa dữ liệu (CEO chọn A, 21/10).
- `assignedUserId` trong kiểu sinh mất `null` (OpenAPI mô tả `allOf[Uuid, string|null]`): hàm nhận nó tự khai `string | null`.
- `/inbox/[id]` (I1b): danh sách bên trái, hội thoại bên phải (`inbox/layout.tsx` kiểm vai trò một lần). Tin xếp theo `platformSentAt` rồi `sequenceNumber` (P10); "Tải tin cũ hơn" theo cursor. Nội dung khách là chữ thuần (React escape, không HTML/markdown, T2 có E2E). Hội thoại không được xem và không tồn tại cùng một câu "Không tìm thấy" (404, P9).
- Phím J/K: hội thoại kế tiếp / trước trong danh sách đã tải, giữ bộ lọc; `?` mở bảng phím tắt (`src/inbox/keys.ts` + `inbox-keys.tsx`, đọc cùng cache với cột danh sách). Bảng chỉ ghi phím đang chạy; T, N, / chờ U31, ghi chú, tìm kiếm.
- Thao tác (I1c): Nhận (phím A), Chờ khách, Đóng (phím E, hộp thoại chọn kết quả). Nút chỉ hiện khi API cho phép (`src/inbox/actions.ts`, cùng luật `permissions.ts` + FSM P14); chờ máy chủ, khóa nút, mỗi lần bấm một `Idempotency-Key` mới. Nhận trượt (409 `conversation_already_claimed`): hiện người đang giữ theo `assignedUserId` của 409, không đọc lại hội thoại (sales/support không còn được xem).
- "Phụ trách" của hội thoại đang mở: Owner/Admin thấy **tên** người giữ (từ `GET /v1/members`, `src/inbox/holder.tsx`); vai trò khác vẫn "Tôi" / "Người khác" / "Chưa ai nhận" (U30).
- Gán lại (Phụ lục B dòng 16, `POST …/assign`): `src/inbox/assign.ts` + `assign-action.tsx`. Danh sách người nhận hợp lệ là U31 (mở): tạm thời chỉ **Owner/Admin** có nút, chọn từ `GET /v1/members` (thành viên đang hoạt động, vai trò giữ được hội thoại, trừ người đang giữ); Manager được gán theo API nhưng chưa đọc được danh sách nên chưa có nút. Danh sách thành viên không nói ai thuộc workspace nào: API trả 422 `invalid_assignee` thì nói câu P9. Hội thoại đang giữ hoặc đang chờ (T16, T21); chờ máy chủ, một `Idempotency-Key` cho một người được chọn. Chuyển (`transfer`, sales/support cùng team) vẫn chờ U31.
- Trả lời khách (I2, N146): `src/inbox/reply-box.tsx` + `composer.ts`. Ô soạn chỉ hiện khi có người giữ hội thoại (`HUMAN_ACTIVE`, `PENDING_CUSTOMER`); owner/admin/manager mọi hội thoại thấy được, sales/support chỉ hội thoại mình giữ. Gửi **lạc quan**: tin hiện ngay ("Đang gửi…", id `local-…`), câu trả lời của API thay vào ("Chờ gửi" theo `deliveryStatus`), bị từ chối thì gỡ tin và trả chữ về ô. Một `Idempotency-Key` cho một nội dung: gửi lại đúng chữ đó sau lỗi dùng lại khóa, chữ khác thì khóa mới. 422 `channel_window_closed` nói lý do theo `reason`; 409 `conversation_not_active` tải lại hội thoại. Ctrl/⌘+Enter gửi, phím R vào ô. Bản nháp chưa lưu server (`/v1/me/drafts` chưa có), không dùng `localStorage`.
- Realtime (I1b-2): một kết nối Socket.IO `/agent` cho khung app (`src/realtime/realtime.tsx`), chỉ với vai trò đọc hội thoại; nằm trong `QueryProvider` nên đổi công ty/workspace hay đăng xuất là ngắt. `state_changed`/`assigned`/`message.created` sửa cache (`src/realtime/events.ts`: không thay bản mới bằng bản cũ). Hội thoại đang mở: `conversation.subscribe`, nối lại thì `resume` từ số tin lớn nhất (`use-conversation-realtime.ts`). Client chỉ gửi `conversationId`, không bao giờ tên phòng (T3, E2E). `session.ended` → `/login`.
- `next start` **không** chuyển tiếp WebSocket (đã thử). Production: admin và API chung địa chỉ gốc sau reverse proxy, `REALTIME_ORIGIN` để trống. Dev/E2E: `REALTIME_ORIGIN=http://localhost:3000` (đọc lúc chạy, không cần build lại); cookie vẫn đi vì cùng tên máy, `Origin` vẫn là địa chỉ admin.

## Hồ sơ cá nhân (#5)

- `/me` (mọi vai trò; tên ở thanh trên là link): 3 phần theo URL `?tab=info|security|notify` (link, không phải tablist).
- Thông tin: chỉ đọc từ `/v1/me` (tên, vai trò, công ty, workspace); đổi tên và ảnh chờ `PATCH /v1/me` (U25).
- Bảo mật: trạng thái 2FA (`security-status`, không có nút tắt); đổi mật khẩu qua `POST /api/auth/change-password` (`revokeOtherSessions` mặc định bật). Better Auth chỉ kiểm độ dài 12–128, nên form kiểm thêm chữ + số (ADR-003) trước khi gửi (`src/profile/password.ts`). "Đăng xuất khỏi các thiết bị khác" = `POST /api/auth/revoke-other-sessions`.
- **Không gọi `/api/auth/list-sessions`**: đường này trả token của mọi phiên cho JavaScript (giữ cho `/revoke-session`, SEC-03). Danh sách phiên của prototype #5 chờ một đường không có token.
- Thông báo: chờ API.

## Workspace (#21)

- `/settings/workspace`, chỉ Owner và Admin như API (N157; Manager xem được hay không còn chờ anh chốt) → vai trò khác trang 403. `GET /v1/workspaces` (theo tên, không cursor): bảng tên + mã, mẫu (lời thường), múi giờ, giới hạn tải mặc định (`src/workspaces/workspace.ts` + `workspace-table.tsx`).
- Sửa tên, múi giờ, giới hạn tải mặc định (`PATCH /v1/workspaces/{id}`): PR sau. Giờ làm việc, ngày nghỉ, SLA, cách phân bổ (prototype #21, spec-M8 §3.3–3.5): chờ API. API giả: `e2e/stub-workspaces.ts`.

## Thành viên (#19)

- `/settings/members`, chỉ Owner và Admin (vai trò khác → trang 403): **Mời thành viên** (`POST /v1/members/invite`, N152; `src/members/invite.ts` + `invite-form.tsx`), rồi **Danh sách** (`GET /v1/members`, N153; `src/members/list.ts` + `member-list.tsx`).
- Vai trò mời được theo Phụ lục B như `members.permissions.ts` của API: Owner mọi vai trò, Admin mọi vai trò trừ Owner. Email gửi đi đã cắt khoảng trắng, chữ thường (như API lưu).
- Chờ máy chủ (tạo thành viên), không lạc quan. Một `Idempotency-Key` cho một cặp email + vai trò: bấm lại sau lỗi dùng lại khóa, API trả câu cũ và không gửi email lần hai.
- Hạn link lấy từ `expiresAt` của API (U1, không ghi cứng 7 ngày). `emailSent: false` → nói lời mời đã tạo nhưng email chưa đi. 409 `duplicate_resource` → "Email này đang có lời mời chờ nhận."
- Email chưa đi (`emailSent: false`) → nút phụ **Gửi lại lời mời** (`POST /v1/members/{id}/resend-invite`, id của câu trả lời vừa nhận): một khóa cho một lời mời tới khi thành công; link mới, hạn mới theo API, link cũ hết dùng. 404 → "Lời mời này không còn chờ nhận".
- Danh sách: thành viên và lời mời, cũ trước, "Tải thêm" theo cursor; tên (hoặc "Chưa nhận lời mời") + email, vai trò, 2FA ("Bắt buộc, chưa cài" cho Owner/Admin chưa bật), trạng thái (`active`/`suspended`/`pending`/`expired`, kèm hạn của lời mời chờ). Lời mời chờ hoặc hết hạn có nút **Gửi lại lời mời** trên dòng nếu người xem được mời vai trò đó (Admin không gửi lại lời mời Owner); xong thì dòng sửa theo câu trả lời (`withRenewed`). Mời hay gửi lại từ form thì đọc lại danh sách.
- **Đổi vai trò** (`PATCH /v1/members/{id}/role`, N154): nút trên dòng thành viên (không phải lời mời), mở hộp thoại chọn vai trò, chờ máy chủ; xong thì dòng lấy câu trả lời của API (`withMember`). Không ai đổi vai trò của chính mình; Admin không sửa Owner và không chọn được Owner (`canChangeRole`). Không có `Idempotency-Key` (PATCH, N154). 409 `last_owner` → "Công ty phải còn ít nhất một Owner đang hoạt động."
- **Đặt lại 2FA** (`POST /v1/members/{id}/2fa/reset`, Q-U20-1, N155): nút "Đặt lại 2FA…" trên dòng thành viên đã bật 2FA, cùng luật với đổi vai trò (không ai tự đặt lại của mình; Admin không đặt lại của Owner, `canResetTwoFactor`). Hộp thoại bắt buộc lý do 1–500 ký tự (lưu audit, `reasonProblem`), chờ máy chủ, một `Idempotency-Key` cho một lý do; xong thì dòng lấy câu trả lời (2FA "Chưa bật"), mọi phiên của người đó bị thu hồi. 409 `shared_account` (người còn thuộc công ty khác hoặc là quản trị nền tảng) → nhờ quản trị nền tảng.
- **Giới hạn tải** (`PATCH /v1/members/{id}/capacity`, C9, N156): cột "Giới hạn tải" (số hội thoại giữ cùng lúc, hoặc "Theo mặc định workspace" khi API trả `null`) và nút trên dòng mọi thành viên đã có tài khoản, kể cả chính mình và Owner (`canSetCapacity`, không phải quyền bảo mật). Hộp thoại nhận số nguyên 1–100 (`capacityValue`), chờ máy chủ, không có `Idempotency-Key`; xong thì dòng lấy câu trả lời. API chưa cho đưa về mặc định workspace (N156), hộp thoại nói vậy.
- Team, lần đăng nhập cuối: chờ API (N153 "Để sau"). API giả của màn này nằm ở `e2e/stub-members.ts` (`MEMBERS`, trang 4 dòng).
