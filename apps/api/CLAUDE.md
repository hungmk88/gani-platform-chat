# apps/api — Domain modules, FSM, endpoint

## Tenant context

- Mọi truy vấn chạy trong `TenantTx` (đã `SET LOCAL app.current_org`,
  `app.current_workspaces`). Không chạy query ngoài wrapper.
- `org_id` lấy từ `RequestContext`, không đọc từ body/query.
- Truy cập chéo tenant trả **404**, không trả 403.

## FSM hội thoại (P14 Brief)

- Chỉ `ConversationStateMachine` được đổi `conversations.state`. Nó, `MessageService` và `OutboxWriter` nằm ở gói `@gani/conversations` (N138), dùng chung với worker.
- Cấm `UPDATE conversations SET state = ...` trực tiếp — lint chặn.
- Mọi transition ghi `conversation_events`.
- Transition không có trong bảng P14 → lỗi.

Các trạng thái: `BOT_ACTIVE`, `HUMAN_WAITING_Q`, `HUMAN_ACTIVE`,
`PENDING_CUSTOMER`, `CLOSED` (+ cờ `after_hours_hold`).

Claim: `UPDATE ... WHERE state='HUMAN_WAITING_Q' RETURNING id` →
0 dòng = 409 `conversation_already_claimed`. Không dùng Redlock.

## API

- REST `/v1`, lỗi RFC 9457 (`application/problem+json`).
- `org_id` không bao giờ nhận từ client.
- Cursor pagination, không offset.
- Agent trả lời khách (`send-message.controller.ts`, N146): `lockConversation` → `canSee`/`mayAct('send_message')` → trạng thái (`HUMAN_ACTIVE`/`PENDING_CUSTOMER`, còn lại 409 `conversation_not_active`) → `ChannelPolicyService.check` (cổng duy nhất, 422 `channel_window_closed`) → `MessageService.append` → `insertPendingDelivery`. Mọi đường gửi ra kênh mới phải qua cùng `check`.
- Idempotency-Key cho POST tạo dữ liệu: gắn `@Idempotent()` (`modules/idempotency`, N134). Thiếu khóa → 400; cùng khóa khác request → 422 `idempotency_key_reused`; đang chạy → 409 `idempotency_in_progress`; 2xx/4xx được trả lại 24 giờ, 5xx thì không.
- Webhook vào: verify → ghi `inbound_events` → trả 200 < 100ms → worker xử lý.
- `GET /v1/me` và `GET /v1/me/security-status` là hai route `/v1` duy nhất không qua middleware tenant (so khớp đúng chuỗi, `tenant-context.middleware.ts`): `/v1/me` tự chọn công ty bằng `chooseOrganisation` (provider `ORGANISATION_SOURCES`), không có thì `org: null` (N145). Thêm route miễn mới phải có lý do và test chính tả lạ.
- Lời mời (`modules/auth/invitations.ts`, N151): plugin Better Auth `/api/auth/invite/lookup` và `/invite/accept`. Người chưa đăng nhập nhận lời mời + đặt mật khẩu + được tạo phiên trong một bước (`acceptInviteWithPassword`, một transaction); người đã đăng nhập đúng email chỉ nhận. Mọi từ chối là 404 `INVITE_INVALID` cùng một câu; bắt buộc `Origin` = `BETTER_AUTH_URL` (cả khi không có cookie); 10 lần/phút theo SHA-256 của token + 60 lần/phút theo địa chỉ (bộ nhớ). Đường này không nằm trong OpenAPI (của Better Auth, như `/sign-in/email`).
- Đổi mật khẩu (N162): dùng `/api/auth/change-password` của Better Auth (không có `/v1/me/password`). Hook `before` **luôn** đặt `revokeOtherSessions: true` (client không giữ được phiên khác); rate limit 5 lần/phút theo địa chỉ; thành công thì hook `after` ghi audit `user.password_changed` ở mỗi công ty người đó còn active (`account-audit.ts` → `app.audit_own_account_event`); audit lỗi chỉ log mã, không đổi câu trả lời.
- Quên mật khẩu (`modules/auth/password-reset.ts`, PR7, N162): plugin Better Auth `/api/auth/password/forgot {email}` **luôn 202** (link được tạo và gửi **sau** khi trả lời, nên câu trả lời và thời gian không lộ email có tồn tại; mỗi email tối đa 3 link/15 phút, quá thì im lặng) và `/password/reset {token, password}` (mật khẩu mạnh kiểm **trước** khi tiêu token; `resetPassword` một transaction: đổi mật khẩu, thu hồi mọi phiên, gỡ khóa, audit `user.password_reset`; không tạo phiên). Link `BETTER_AUTH_URL/reset-password#token=`, 30 phút, một lần. Mọi từ chối token là 404 `RESET_INVALID` cùng một câu; bắt buộc `Origin`; rate limit theo địa chỉ + 10 lần/phút theo SHA-256 của token. Sender SMTP do `AuthService.fromEnv` tạo theo cùng `emailPolicy` (N149).
- Email (`modules/members/invite-mailer.ts`, N149): một `InviteMailer` cho cả ứng dụng, cấu hình đọc lúc khởi động bằng `emailPolicy`; `APP_ENV=production` thiếu `SMTP_URL`/`EMAIL_FROM` hay kết nối không mã hóa thì API **không khởi động**, môi trường khác thiếu `SMTP_URL` thì gửi vào Mailpit. Chỉ gửi sau khi transaction đã commit; lỗi là `false` + log mã lỗi và id, không địa chỉ. Link lời mời là `BETTER_AUTH_URL/invite#token=` (trang và `/api/auth/invite/*` cùng origin, N136).
- Mời thành viên (`modules/members/`, N152): `POST /v1/members/invite` và `/{id}/resend-invite` (token mới, thêm 7 ngày, link cũ hết dùng), Owner mời mọi vai trò, Admin mọi vai trò trừ Owner (Phụ lục B, `members.permissions.ts`). Một TenantTx: dòng `org_members` chỉ có SHA-256 của token + audit `member.invited`/`member.invite_resent` (không email); **sau commit** mới gửi email (`InviteMailer`). Gửi lỗi thì vẫn 201/200 với `emailSent: false`. Email trùng lời mời đang chờ → 409 `duplicate_resource`. `GET /v1/members` (N153): chỉ Owner/Admin (kiểm **trước** khi đọc view `app.org_member_directory`, vì view có email, N12), cursor, lời mời quá hạn là `status: expired`. `PATCH /v1/members/{id}/role` (N154): khóa các Owner active **trước**, rồi mới khóa thành viên (luôn theo thứ tự này), để công ty không bao giờ còn 0 Owner (409 `last_owner`); không ai đổi vai trò của mình; Admin không chạm tới Owner. `PATCH /v1/members/{id}/capacity` (N156): Owner/Admin đặt giới hạn tải riêng 1–100 cho mọi thành viên (cả chính mình), ghi `agent_settings`, audit `member.capacity_changed {from, to}`; `Member.maxConcurrentConversations` null = theo mặc định workspace. `POST /v1/members/{id}/2fa/reset {reason}` (N155, `Idempotency-Key`): cùng luật người làm (không tự làm cho mình, Admin không chạm Owner); hàm `app.reset_member_two_factor` tắt 2FA và thu hồi mọi phiên trong cùng TenantTx, audit `member.two_factor_reset` giữ `reason` (không bao giờ ra log); người còn thuộc công ty khác hay platform operator → 409 `shared_account`.
- Workspace (`modules/workspaces/`, N157): `GET /v1/workspaces` và `PATCH /v1/workspaces/{id}` (tên, múi giờ IANA, `defaultMaxConcurrent`; không đổi slug/mẫu), chỉ Owner/Admin; audit `workspace.updated` với `<trường>From`/`<trường>To`. Tạo workspace là lệnh `tenant:create-workspace` (spec-M8 A2), không có POST (N157 mục 3). `GET/PUT /v1/workspaces/{id}/members` (N159): Owner/Admin đặt **toàn bộ** danh sách theo id thành viên (active/suspended của công ty, khác → 400); người bị bỏ `deleted_at`, người quay lại bật lại dòng cũ; audit `workspace.members_changed {added, removed}`; có hiệu lực từ request kế tiếp.
- Team (`modules/teams/`, A4, N160): `GET/POST /v1/teams`, `PATCH/DELETE /v1/teams/{id}`, `GET/PUT /v1/teams/{id}/members`, `PUT /v1/teams/{id}/channels` (N161). Owner/Admin ghi; Manager chỉ đọc team mình. Slug tự sinh từ tên. Mọi thao tác ghi khóa **workspace trước, team sau** (`teamWorkspaceId` đọc không khóa), để hai lần đặt team mặc định cùng lúc chạy lần lượt; tối đa một team mặc định mỗi workspace (index DB), xóa team mặc định hay team còn phụ trách kênh → 409 `team_in_use`. Thành viên team phải là thành viên workspace của team. Một kênh thuộc tối đa một team (`channel_accounts.team_id`); gán kênh của team khác thì kênh chuyển sang, audit `team.channels_changed {added, removed, moved}`; thứ tự khóa workspace → team → kênh.
- Kênh (`modules/channels/`, N161): `GET /v1/channels?workspaceId=` cho màn team chọn kênh, chỉ Owner/Admin; chỉ metadata (`id`, `type`, `displayName`, `status`, `teamId`), **không bao giờ** đọc hay trả cột `_enc`.
- Mẫu trả lời nhanh (`modules/quick-replies/`, C7, N163): `GET/POST /v1/quick-replies`, theo workspace (RLS O+W). Owner/Admin/Manager ghi; Owner/Admin/Manager/Sales/Support đọc (`quick-replies.permissions.ts`); workspace không thuộc phiên → 404. Body chỉ được chứa biến Đợt 1 (`variables.ts`: `customer_name`, `agent_name`, `company_name`, `company_phone`), biến lạ → 400. Shortcut trùng trong workspace → 409 `duplicate_resource`. Không audit (endpoint-M8 §2).
- CSRF (N136): request dưới `/v1` không phải GET/HEAD/OPTIONS mà có cookie phải có `Origin` = `BETTER_AUTH_URL` (`same-origin.ts`), sai → 403. Test gửi POST `/v1` có cookie thì phải kèm header `origin`.

## Kiểm chứng

- `claim-race.spec`: 50 agent claim cùng lúc → đúng 1 thắng.
- `tenant-isolation.spec`, `workspace-isolation.spec` sinh từ OpenAPI.
- Mọi endpoint mới phải có OpenAPI cập nhật trong cùng PR. OpenAPI **sinh từ Zod** (`@asteasolutions/zod-to-openapi`, quyết định 19/10/2026): schema Zod của endpoint vừa để kiểm request (`ZodPipe`, sai → 400 `validation_failed`, chỉ nêu tên trường) vừa để mô tả. Đăng ký path trong `src/openapi/document.ts` (hàm `register…` của module), rồi `pnpm --filter @gani/api build && pnpm --filter @gani/api openapi` và commit `docs/openapi/openapi.json`; `document.test.ts` đỏ khi file lệch với mã.
- Mã lỗi `code` dạng snake_case theo bảng P9 (N132).

## Cấm

- Không `any` trong `apps/api/src/modules/*`.
- Không log nội dung tin nhắn, chỉ log `messageId`.

## TypeScript, ESM và decorator (PR1b)

- Gói `"type": "module"`; NestJS 12 là ESM, dùng Express 5. **Mọi import tương đối phải có đuôi `.js`** (kể cả khi file là `.ts`).
- NestJS đọc `design:paramtypes` để tiêm phụ thuộc → mã phải biên dịch bằng `tsc` hoặc SWC. **Không dùng `tsx`/esbuild** để chạy hay test API (không sinh metadata; DI sẽ lỗi âm thầm).
- `tsconfig.json` của `apps/api` tách riêng: `experimentalDecorators` + `emitDecoratorMetadata` bật, `verbatimModuleSyntax` tắt. Import một class dùng làm kiểu tham số constructor phải là import giá trị, không dùng `import type`.
- Dev: `pnpm --filter @gani/api dev` (`tsc --watch` + `node --watch`). Test: Vitest + `unplugin-swc` (cùng cách biên dịch decorator với bản chạy thật).
- `/healthz` chỉ báo còn sống (liveness), không đụng phụ thuộc. `/readyz` kiểm kết nối DB (`SELECT 1` bằng `app_role`, timeout 2s): 200 `{"status":"ok"}` hoặc 503 `{"status":"unavailable"}`, không kèm lý do. Khi realtime dùng Valkey (`REDIS_URL`), `/readyz` kiểm thêm `PING` (2s). Thiếu `DATABASE_URL_APP` thì `/readyz` 503 và `/healthz` vẫn 200. `/readyz` cũng kiểm pool `auth_role` (đăng nhập): một trong hai pool không đạt thì 503. Khác với `DATABASE_URL_APP`, thiếu hay sai cấu hình xác thực (`BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `DATABASE_URL_AUTH`) thì **ứng dụng không khởi động** và báo rõ phải sửa gì (N90).
- Ứng dụng tạo bằng `bodyParser: false` rồi gọi `setupApp` (`src/app-setup.ts`): trước hết là cổng 2FA (`two-factor.gate.ts`, N93: người phải thiết lập 2FA mà chưa xong chỉ đi được vài route, mọi đường khác 403), rồi Better Auth gắn ở `/api/auth/*` **trước khi Nest khởi tạo router** (gắn sau thì Nest trả `404`, đã đo), rồi mới tới parser JSON của Nest, để thư viện tự đọc body của nó (khuyến cáo của thư viện). `main.ts` và mọi test phục vụ ứng dụng đều dùng `setupApp`.
- `@gani/db` và `@gani/domain` được build ra `dist/` (`exports` trỏ `dist`; domain từ N108, trước đó API build xanh mà `node dist/main.js` không chạy được): chạy `pnpm build` trước `pnpm lint` và `pnpm --filter @gani/api typecheck`. `pnpm typecheck`/`pnpm test` (turbo) tự build trước.
- `pnpm --filter @gani/api smoke` khởi động `dist/main.js` thật rồi hỏi `/healthz` (CI job `verify` chạy nó sau `pnpm build`): chạy sau khi đổi `exports` hay phụ thuộc của một gói workspace.

## Realtime (Socket.IO `/agent`, realtime-spec, N94, N142)

- `modules/realtime/`: `RealtimeService.attach(httpServer, deps)` gắn `socket.io` thẳng vào HTTP server, gọi trong `setupApp` (main và mọi test đều có). Chỉ WebSocket; namespace `/` từ chối.
- **Express không chạy cho socket** (cổng 2FA, middleware tenant, same-origin): bắt tay (`handshake.ts`) tự làm lại theo thứ tự Origin → phiên → 2FA → `chooseOrganisation` (dùng chung với `/v1`) → member → `socket.data.ctx` (đóng băng). Lỗi qua `connect_error` với `data: { code, traceId }`, không nguyên nhân. Thêm bước kiểm mới cho HTTP thì xem có phải thêm vào bắt tay không.
- Phòng (`rooms.ts`): `org:`, `user:`, và `ws:` chỉ cho vai trò đọc được hội thoại. Tên phòng chỉ dựng từ `ctx`, không từ client.
- Sự kiện client (`agent-events.ts`): `conversation.subscribe`/`unsubscribe` (Zod; không thấy → `not_found` như REST 404; tối đa 20 phòng `conv:`), `resume` (vào phòng **trước** rồi mới đọc `listMessagesAfter`, tối đa 200 tin, `resync` khi client đi trước; 10 lần/10 giây). Mỗi sự kiện chạy trong `runWithRequestContext` + `withTenant`, `traceId` mới; ack `{ ok:false, code, traceId }`.
- Kiểm lại phiên (`revalidate.ts`, R5): mỗi `SOCKET_REVALIDATE_S` (60) giây và trước subscribe/resume khi bản kiểm đã cũ, chạy lại bước 2–5 với `SessionResolver.resolveFresh` (**không** `resolve`: WeakMap theo request sống suốt socket). Từ chối hay DB lỗi → `session.ended { code }` rồi ngắt; đổi vai trò/workspace → đổi phòng `ws:` và bỏ mọi phòng `conv:`.
- Valkey (`valkey.ts`, N144): có `REDIS_URL` → `@socket.io/redis-adapter` (gói worker phát và của instance khác tới được socket ở đây); thiếu `REDIS_URL` khi `APP_ENV=production` → API **không khởi động**; dev/test → adapter bộ nhớ + cảnh báo (test api-int ở job `db` không có Valkey).
- Test: `realtime-handshake.integration.test.ts`, `realtime-events.integration.test.ts` (client `socket.io-client` thật, cookie + `origin` trong `extraHeaders`).
