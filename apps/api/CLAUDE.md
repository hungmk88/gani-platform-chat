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
- Idempotency-Key cho POST tạo dữ liệu: gắn `@Idempotent()` (`modules/idempotency`, N134). Thiếu khóa → 400; cùng khóa khác request → 422 `idempotency_key_reused`; đang chạy → 409 `idempotency_in_progress`; 2xx/4xx được trả lại 24 giờ, 5xx thì không.
- Webhook vào: verify → ghi `inbound_events` → trả 200 < 100ms → worker xử lý.
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
- `/healthz` chỉ báo còn sống (liveness), không đụng phụ thuộc. `/readyz` kiểm kết nối DB (`SELECT 1` bằng `app_role`, timeout 2s): 200 `{"status":"ok"}` hoặc 503 `{"status":"unavailable"}`, không kèm lý do. Valkey thêm khi có BullMQ. Thiếu `DATABASE_URL_APP` thì `/readyz` 503 và `/healthz` vẫn 200. `/readyz` cũng kiểm pool `auth_role` (đăng nhập): một trong hai pool không đạt thì 503. Khác với `DATABASE_URL_APP`, thiếu hay sai cấu hình xác thực (`BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `DATABASE_URL_AUTH`) thì **ứng dụng không khởi động** và báo rõ phải sửa gì (N90).
- Ứng dụng tạo bằng `bodyParser: false` rồi gọi `setupApp` (`src/app-setup.ts`): trước hết là cổng 2FA (`two-factor.gate.ts`, N93: người phải thiết lập 2FA mà chưa xong chỉ đi được vài route, mọi đường khác 403), rồi Better Auth gắn ở `/api/auth/*` **trước khi Nest khởi tạo router** (gắn sau thì Nest trả `404`, đã đo), rồi mới tới parser JSON của Nest, để thư viện tự đọc body của nó (khuyến cáo của thư viện). `main.ts` và mọi test phục vụ ứng dụng đều dùng `setupApp`.
- `@gani/db` và `@gani/domain` được build ra `dist/` (`exports` trỏ `dist`; domain từ N108, trước đó API build xanh mà `node dist/main.js` không chạy được): chạy `pnpm build` trước `pnpm lint` và `pnpm --filter @gani/api typecheck`. `pnpm typecheck`/`pnpm test` (turbo) tự build trước.
- `pnpm --filter @gani/api smoke` khởi động `dist/main.js` thật rồi hỏi `/healthz` (CI job `verify` chạy nó sau `pnpm build`): chạy sau khi đổi `exports` hay phụ thuộc của một gói workspace.

## Realtime (Socket.IO `/agent`, realtime-spec, N94, N142)

- `modules/realtime/`: `RealtimeService.attach(httpServer, deps)` gắn `socket.io` thẳng vào HTTP server, gọi trong `setupApp` (main và mọi test đều có). Chỉ WebSocket; namespace `/` từ chối.
- **Express không chạy cho socket** (cổng 2FA, middleware tenant, same-origin): bắt tay (`handshake.ts`) tự làm lại theo thứ tự Origin → phiên → 2FA → `chooseOrganisation` (dùng chung với `/v1`) → member → `socket.data.ctx` (đóng băng). Lỗi qua `connect_error` với `data: { code, traceId }`, không nguyên nhân. Thêm bước kiểm mới cho HTTP thì xem có phải thêm vào bắt tay không.
- Phòng (`rooms.ts`): `org:`, `user:`, và `ws:` chỉ cho vai trò đọc được hội thoại. Tên phòng chỉ dựng từ `ctx`, không từ client.
- Sự kiện client (`agent-events.ts`): `conversation.subscribe`/`unsubscribe` (Zod; không thấy → `not_found` như REST 404; tối đa 20 phòng `conv:`), `resume` (vào phòng **trước** rồi mới đọc `listMessagesAfter`, tối đa 200 tin, `resync` khi client đi trước; 10 lần/10 giây). Mỗi sự kiện chạy trong `runWithRequestContext` + `withTenant`, `traceId` mới; ack `{ ok:false, code, traceId }`.
- Kiểm lại phiên (`revalidate.ts`, R5): mỗi `SOCKET_REVALIDATE_S` (60) giây và trước subscribe/resume khi bản kiểm đã cũ, chạy lại bước 2–5 với `SessionResolver.resolveFresh` (**không** `resolve`: WeakMap theo request sống suốt socket). Từ chối hay DB lỗi → `session.ended { code }` rồi ngắt; đổi vai trò/workspace → đổi phòng `ws:` và bỏ mọi phòng `conv:`.
- Test: `realtime-handshake.integration.test.ts`, `realtime-events.integration.test.ts` (client `socket.io-client` thật, cookie + `origin` trong `extraHeaders`).
