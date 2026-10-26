# Báo cáo session Backend — Gani Foods Platform

Session `session_01K8V4vrQNXt2JfmZLweh2JE` · repo `hungmk88/gani-platform-chat` · cập nhật **26/10/2026, 14:40 UTC**

## 1. Tổng quan

| Chỉ số | Giá trị |
|---|---|
| Thời gian | 19/10/2026 → 26/10/2026 (PR đầu tiên merge 20/10) |
| PR đã merge mang mã session này | **82** (mục 4) |
| Đầu việc trong danh sách task | 53/53 xong |
| Quyết định mới ghi vào `QUESTIONS.md` | N128–N166 (mục 5) |
| PR đang mở | [#323](https://github.com/hungmk88/gani-platform-chat/pull/323): phản hồi Backend cho gói câu hỏi 30/10 (docs) |
| PR đã đóng vì trùng `main` (26/10) | #267 (đã vào qua #265), #307 (qua #308), #312 và #314 (qua #316) |

Cách làm xuyên suốt:
- **Phương án trước:** trình phương án (AskUserQuestion) trước mỗi tính năng. Từ khi anh dặn "Làm tiếp đừng chờ", em tự chốt và ghi lý do vào `QUESTIONS.md` (N164–N166).
- **PR và commit:** mỗi PR ≤ 400 dòng (vượt thì báo trước khi push), Conventional Commits, PR body theo template.
- **Kiểm chứng trước khi push:**
  - build, lint, typecheck, test, format:check, lint:migrations, migrate;
  - db-int ×2, api-int, worker-int, smoke; admin e2e khi đổi kiểu dùng chung;
  - kiểm đột biến cho logic quan trọng;
  - gitleaks và quét chuỗi bí mật.

## 2. Kết quả theo mảng

| Mảng | Kết quả chính | Quyết định |
|---|---|---|
| Rà soát H/I và sửa lỗi | Người bị xóa mềm mất quyền đăng nhập và phiên (DB-01); hợp đồng lỗi chung, header bảo mật, không trả token trong JSON (AR-03, AR-04, SEC-03); migration CONCURRENTLY ngoài transaction (DB-03); khóa hội thoại trước transition (AR-05); outbox đếm lần thử đúng (E-02); lỗi DB của auth được làm sạch (SEC-01); test DB chạy lại được (TEST-01); `/healthz` và `/metrics` của worker | N128–N131 |
| Nền tảng API Hộp thư | Mã lỗi snake_case + traceId (P9); cursor có phiên bản; Idempotency-Key 24 giờ; CSRF theo Origin; quyền đọc hội thoại, RLS từ chối thành 404; `GET /v1/conversations`, `/{id}`, `/{id}/messages` | N132–N136 |
| Quyền DB | `app_role` chỉ UPDATE theo cột; `support_role` không thấy `external_user_id`; `memberships_for_user` gắn `auth_user_id` | N137 |
| Lát dọc Zalo → agent | Gói `@gani/conversations`; webhook Zalo (chữ ký, lưu một lần, 200 nhanh); InboundProcessor; consumer; Socket.IO `/agent` (bắt tay, phòng, subscribe, resume, kiểm lại phiên); Valkey adapter; worker phát sự kiện realtime; e2e webhook → socket | N138–N144 |
| Agent trả lời khách | `windowState` + chính sách kênh; `message_deliveries`; `ChannelPolicyService.check` là cổng gửi duy nhất; `POST /v1/conversations/{id}/messages`; test thứ tự khóa | N146 |
| `GET /v1/me` | Khung app admin đọc người dùng, công ty, workspace | N145 |
| Onboarding | `lookup_invite`/`accept_invite`; bootstrap platform operator; InviteMailer (gửi sau commit); `tenant:create-org`; nhận lời mời một bước + trang `/invite` | N147–N151 |
| Thành viên | Mời và gửi lại lời mời; danh sách (view có email chỉ cho Owner/Admin); đổi vai trò (không để công ty còn 0 Owner); đặt lại 2FA; giới hạn tải riêng | N152–N156 |
| Workspace | `GET/PATCH /v1/workspaces`; `tenant:create-workspace`; `GET/PUT /v1/workspaces/{id}/members` | N157–N159 |
| Team và kênh | CRUD team, thành viên team, một kênh một team, `GET /v1/channels` | N160, N161 |
| Tài khoản cá nhân | `PATCH /v1/me`; siết `/change-password` (luôn thu hồi phiên khác, rate limit, audit); quên/đặt lại mật khẩu (link 30 phút, một lần, luôn 202) | N162 |
| Mẫu trả lời nhanh (C7) | Bảng `quick_replies` (RLS O+W); CRUD; `used`; `preview`; chặn gửi tin còn `{{…}}` (422); `workspaces.contact_phone` | N163 |
| U37 và CRM lõi (J1/J2) | `me.workspaces[].contactPhone` cho mọi vai trò; `customers`, `customer_identities` (UID Zalo theo OA); worker gắn khách vào hội thoại; `Conversation.customer`; `GET/PATCH /v1/customers`, che SĐT/email cho Marketing/Viewer; SĐT chuẩn `+84` | N164, N165 |
| Bảo trì | Vá 3 lỗ hổng HIGH của `pnpm audit`; sửa test có thể đỏ ngẫu nhiên vì `traceId` (#313) | — |

## 3. Việc trong ngày 26/10 (lượt cuối)

1. **Theo dõi PR C7:** #298 và #302 xanh rồi merge; gộp `main` vào #302 sau mỗi lần squash.
2. **U37 (#306):** `contactPhone` trong `/v1/me` cho mọi vai trò.
3. **CRM lõi:** #307 (bảng) → #308 (worker) → #312 (`Conversation.customer`) → #314 (đọc khách, SĐT) → #316 (`GET /v1/customers`) → #321 (`PATCH`). Merge qua squash của #308, #316, #321.
4. **CI `main` đỏ, phân tích từng lần:**
   - `3958dc9`: test dò rò rỉ trùng `traceId` ngẫu nhiên → sửa ở #313;
   - `9bbec46`: test kill-9 của worker hết giờ ở phía consumer, commit kế tiếp xanh;
   - `7b50b80`: admin e2e `quick-replies.spec.ts` gõ nhầm ô, chạy lại ở máy xanh.
5. **Đóng PR trùng `main`:** #267, #307, #312, #314, mỗi PR có comment giải thích.
6. **Phản hồi lời nhắc hạn 30/10:** `docs/ui/phan-hoi-backend-30-10.md` (#323), gồm trạng thái spec M8 phần Backend, trả lời U25–U38 và phân loại U40–U51.

## 4. PR đã merge

**2026-10-20**

| PR | Nội dung |
|---|---|
| [#116](https://github.com/hungmk88/gani-platform-chat/pull/116) | fix(api): treat a soft-deleted person as gone for sign-in, sessions and the 2FA gate (DB-01) |
| [#115](https://github.com/hungmk88/gani-platform-chat/pull/115) | fix(db): leave soft-deleted users out of memberships and revoke their sessions (DB-01) |
| [#118](https://github.com/hungmk88/gani-platform-chat/pull/118) | fix(api): one error contract, security headers and no session token in JSON (AR-03, AR-04, SEC-03) |
| [#121](https://github.com/hungmk88/gani-platform-chat/pull/121) | fix(db): run CONCURRENTLY migrations outside a transaction and bound lock waits (DB-03) |
| [#136](https://github.com/hungmk88/gani-platform-chat/pull/136) | feat(db): opaque versioned cursors for keyset pagination |
| [#132](https://github.com/hungmk88/gani-platform-chat/pull/132) | fix(api): answer every error with the snake_case codes of Brief P9 and the request's traceId (N132) |
| [#141](https://github.com/hungmk88/gani-platform-chat/pull/141) | feat(db): keep Idempotency-Keys, so a POST sent again gives back its first answer (N134) |
| [#142](https://github.com/hungmk88/gani-platform-chat/pull/142) | feat(api): Idempotency-Key interceptor — gửi lại POST trả kết quả cũ (N134, PR-D2) |
| [#122](https://github.com/hungmk88/gani-platform-chat/pull/122) | fix(db): take the conversation's lock before a transition, as a message does (AR-05) |
| [#130](https://github.com/hungmk88/gani-platform-chat/pull/130) | fix(domain): close a conversation with resolved, no_response or spam, as Brief v1.0 says (N130) |
| [#144](https://github.com/hungmk88/gani-platform-chat/pull/144) | feat(api): refuse a change under /v1 from another origin when it carries the session cookie (CSRF, N136) |
| [#139](https://github.com/hungmk88/gani-platform-chat/pull/139) | feat(api): who may read which conversation, the shapes of the Inbox API, and RLS refusals as 404 |
| [#120](https://github.com/hungmk88/gani-platform-chat/pull/120) | docs(review): add full codebase audit report (H) and record N112, N113, N129 |
| [#124](https://github.com/hungmk88/gani-platform-chat/pull/124) | docs(review): add the progress and review of 19/10 (I), N130 and N131 |

**2026-10-21**

| PR | Nội dung |
|---|---|
| [#154](https://github.com/hungmk88/gani-platform-chat/pull/154) | fix(db): thu hẹp quyền UPDATE của app_role theo cột, ẩn external_user_id với support_role (DB-05, DBM-01, DBM-06) |
| [#125](https://github.com/hungmk88/gani-platform-chat/pull/125) | fix(db): fail an outbox claim only with the attempts of that claim (E-02) |
| [#140](https://github.com/hungmk88/gani-platform-chat/pull/140) | feat(api): serve the Inbox: GET /v1/conversations, /{id} and /{id}/messages |
| [#117](https://github.com/hungmk88/gani-platform-chat/pull/117) | fix(api): clean the errors of the auth database before Better Auth logs them (SEC-01) |
| [#127](https://github.com/hungmk88/gani-platform-chat/pull/127) | feat(worker): serve /healthz and /metrics from the worker (OPS-02) |
| [#155](https://github.com/hungmk88/gani-platform-chat/pull/155) | refactor(conversations): tách FSM, MessageService, OutboxWriter ra gói @gani/conversations (V1, N138) |
| [#119](https://github.com/hungmk88/gani-platform-chat/pull/119) | test(db): let the integration tests run again on a database already used (TEST-01) |
| [#161](https://github.com/hungmk88/gani-platform-chat/pull/161) | feat(api): nhận webhook Zalo: kiểm chữ ký, lưu một lần, trả 200 (V4, N140) |
| [#179](https://github.com/hungmk88/gani-platform-chat/pull/179) | feat(api): bắt tay, phòng và máy chủ Socket.IO /agent (V7b-1 + #176) |
| [#183](https://github.com/hungmk88/gani-platform-chat/pull/183) | feat(db): listMessagesAfter cho resume (V7c-1) |
| [#184](https://github.com/hungmk88/gani-platform-chat/pull/184) | feat(api): conversation.subscribe và resume qua socket /agent (V7c-2) |

**2026-10-22**

| PR | Nội dung |
|---|---|
| [#185](https://github.com/hungmk88/gani-platform-chat/pull/185) | feat(api): kiểm lại phiên của socket /agent + test N3/N5/N9 (V7c-3 + #186) |
| [#190](https://github.com/hungmk88/gani-platform-chat/pull/190) | feat(api): adapter Valkey cho Socket.IO của API (V8a, N144) |
| [#193](https://github.com/hungmk88/gani-platform-chat/pull/193) | feat(worker): emitter realtime và loadMessageView (V8b-1) |
| [#192](https://github.com/hungmk88/gani-platform-chat/pull/192) | feat(worker): phát sự kiện outbox tới socket /agent (V8b-2) |
| [#198](https://github.com/hungmk88/gani-platform-chat/pull/198) | feat(db): readOrgSummary đọc tên công ty và workspace dưới RLS (U32) |
| [#199](https://github.com/hungmk88/gani-platform-chat/pull/199) | feat(api): GET /v1/me cho khung app admin (U32, N145, 2/2) |
| [#203](https://github.com/hungmk88/gani-platform-chat/pull/203) | feat(domain,db): windowState và đọc chính sách kênh trước khi gửi (8a-1) |
| [#206](https://github.com/hungmk88/gani-platform-chat/pull/206) | feat(db): bảng message_deliveries cho tin "chờ gửi" (8a-1b, N146) |
| [#207](https://github.com/hungmk88/gani-platform-chat/pull/207) | feat(conversations): ChannelPolicyService.check, cổng gửi duy nhất (8a-2) |
| [#195](https://github.com/hungmk88/gani-platform-chat/pull/195) | test(worker): webhook Zalo có chữ ký tới được socket của agent (V8c, e2e lát dọc) |
| [#209](https://github.com/hungmk88/gani-platform-chat/pull/209) | feat(api): POST /v1/conversations/{id}/messages, agent trả lời khách (8a-3, N146) |
| [#210](https://github.com/hungmk88/gani-platform-chat/pull/210) | test(api): thứ tự khóa của POST …/messages (8a-4, N107(13)) |
| [#215](https://github.com/hungmk88/gani-platform-chat/pull/215) | feat(db): app.lookup_invite và app.accept_invite (DB-02a-1, N147) |
| [#219](https://github.com/hungmk88/gani-platform-chat/pull/219) | feat(worker): lõi tenant:create-org, tạo công ty và mời Owner đầu tiên (DB-02a-3a, A1, N150) |
| [#220](https://github.com/hungmk88/gani-platform-chat/pull/220) | feat(worker): lệnh tenant:create-org cho pipeline (DB-02a-3b, A1, N150) |
| [#223](https://github.com/hungmk88/gani-platform-chat/pull/223) | feat(db): acceptInviteWithPassword, nhận lời mời một bước (DB-02b-a, N151) |
| [#225](https://github.com/hungmk88/gani-platform-chat/pull/225) | feat(auth): /api/auth/invite/lookup và /accept, nhận lời mời một bước (DB-02b-b, N151) |
| [#227](https://github.com/hungmk88/gani-platform-chat/pull/227) | feat(db): lời mời thành viên do Owner/Admin tạo và gửi lại (DB-02b-c-1) |
| [#216](https://github.com/hungmk88/gani-platform-chat/pull/216) | feat(ops): bootstrap platform operator đầu tiên (DB-02a-2, N25, N148) |
| [#228](https://github.com/hungmk88/gani-platform-chat/pull/228) | feat(api): InviteMailer, gửi email lời mời sau commit (DB-02b-c-2, N149) |

**2026-10-23**

| PR | Nội dung |
|---|---|
| [#229](https://github.com/hungmk88/gani-platform-chat/pull/229) | feat(api): POST /v1/members/invite, Owner/Admin mời thành viên (DB-02b-c-3, N152) |
| [#230](https://github.com/hungmk88/gani-platform-chat/pull/230) | feat(api): POST /v1/members/{id}/resend-invite, gửi lại lời mời (DB-02b-c-4, N152) |
| [#233](https://github.com/hungmk88/gani-platform-chat/pull/233) | feat(admin): trang /invite, nhận lời mời một bước (DB-02b-d, N151) |
| [#237](https://github.com/hungmk88/gani-platform-chat/pull/237) | feat(db): view app.org_member_directory và listMembers cho màn thành viên (DB-02b-e-1, N153) |
| [#238](https://github.com/hungmk88/gani-platform-chat/pull/238) | feat(api): GET /v1/members, danh sách thành viên cho Owner/Admin (DB-02b-e-2, N153) |

**2026-10-24**

| PR | Nội dung |
|---|---|
| [#240](https://github.com/hungmk88/gani-platform-chat/pull/240) | feat(api): PATCH /v1/members/{id}/role, đổi vai trò thành viên (DB-02b-f, N154) |
| [#243](https://github.com/hungmk88/gani-platform-chat/pull/243) | fix(deps): vá 3 lỗ hổng HIGH của pnpm audit (zod, body-parser, multer) |
| [#246](https://github.com/hungmk88/gani-platform-chat/pull/246) | feat(db): app.reset_member_two_factor, đặt lại 2FA của thành viên (DB-02b-g-a, N155) |
| [#249](https://github.com/hungmk88/gani-platform-chat/pull/249) | feat(api): POST /v1/members/{id}/2fa/reset, đặt lại 2FA của thành viên (DB-02b-g-b, N155) |
| [#251](https://github.com/hungmk88/gani-platform-chat/pull/251) | feat(api): PATCH /v1/members/{id}/capacity, giới hạn tải riêng của agent (DB-02b-h, C9, N156) |
| [#254](https://github.com/hungmk88/gani-platform-chat/pull/254) | feat(api): GET /v1/workspaces và PATCH /v1/workspaces/{id} (DB-07, N157) |

**2026-10-25**

| PR | Nội dung |
|---|---|
| [#261](https://github.com/hungmk88/gani-platform-chat/pull/261) | feat(worker): lệnh tenant:create-workspace cho pipeline (DB-07b, A2, N158) |
| [#262](https://github.com/hungmk88/gani-platform-chat/pull/262) | feat(db): workspace-member-store, danh sách và gán thành viên workspace (DB-07c-a, N159) |
| [#264](https://github.com/hungmk88/gani-platform-chat/pull/264) | feat(api): GET/PUT /v1/workspaces/{id}/members, gán thành viên workspace (DB-07c-b, N159) |
| [#269](https://github.com/hungmk88/gani-platform-chat/pull/269) | feat(db): teams thêm mô tả và team mặc định, team-store (A4-T1, N160) |
| [#271](https://github.com/hungmk88/gani-platform-chat/pull/271) | feat(api): GET/POST /v1/teams, danh sách và tạo team (A4-T2a, N160) |
| [#272](https://github.com/hungmk88/gani-platform-chat/pull/272) | feat(api): PATCH/DELETE /v1/teams/{id}, sửa và kết thúc team (A4-T2b, N160) |
| [#273](https://github.com/hungmk88/gani-platform-chat/pull/273) | feat(api): GET/PUT /v1/teams/{id}/members, thành viên team (A4-T2c, N160) |
| [#275](https://github.com/hungmk88/gani-platform-chat/pull/275) | feat(db): channel_accounts.team_id, team phụ trách kênh và channel-store (A4-T3a, N161) |
| [#278](https://github.com/hungmk88/gani-platform-chat/pull/278) | feat(api): GET /v1/channels, kênh của workspace và team phụ trách (A4-T3b, N161) |

**2026-10-26**

| PR | Nội dung |
|---|---|
| [#281](https://github.com/hungmk88/gani-platform-chat/pull/281) | feat(api): PATCH /v1/me, người dùng đổi tên của mình (A5, N162) |
| [#284](https://github.com/hungmk88/gani-platform-chat/pull/284) | feat(db): app.audit_own_account_event, audit đổi/đặt lại mật khẩu ở mỗi công ty (A5, N162) |
| [#285](https://github.com/hungmk88/gani-platform-chat/pull/285) | feat(api): siết /api/auth/change-password, luôn thu hồi phiên khác và ghi audit (A5, N162) |
| [#286](https://github.com/hungmk88/gani-platform-chat/pull/286) | feat(db): token đặt lại mật khẩu, 30 phút dùng một lần (A5, PR7, N162) |
| [#288](https://github.com/hungmk88/gani-platform-chat/pull/288) | feat(api): quên mật khẩu, /api/auth/password/forgot và /password/reset (A5, PR7, N162) |
| [#279](https://github.com/hungmk88/gani-platform-chat/pull/279) | feat(api): PUT /v1/teams/{id}/channels, gán kênh phụ trách cho team (A4-T3c, N161) |
| [#292](https://github.com/hungmk88/gani-platform-chat/pull/292) | feat(db): bảng quick_replies, mẫu trả lời nhanh của workspace (C7a, N163) |
| [#294](https://github.com/hungmk88/gani-platform-chat/pull/294) | feat(api): GET/POST /v1/quick-replies, danh sách và tạo mẫu trả lời nhanh (C7b1, N163) |
| [#296](https://github.com/hungmk88/gani-platform-chat/pull/296) | feat(api): workspaces.contact_phone, số liên hệ cho {{company_phone}} (C7c1, N163) |
| [#295](https://github.com/hungmk88/gani-platform-chat/pull/295) | feat(api): PATCH/DELETE /v1/quick-replies/{id}, sửa và xóa mẫu trả lời nhanh (C7b2, N163) |
| [#298](https://github.com/hungmk88/gani-platform-chat/pull/298) | feat(api): /v1/quick-replies/{id}/used và chặn gửi tin còn {{…}} (C7c2, N163) |
| [#302](https://github.com/hungmk88/gani-platform-chat/pull/302) | feat(api): POST /v1/quick-replies/{id}/preview, xem trước mẫu với dữ liệu mẫu (C7c3, N163) |
| [#306](https://github.com/hungmk88/gani-platform-chat/pull/306) | feat(api): GET /v1/me trả contactPhone của workspace cho mọi vai trò (U37, N164) |
| [#313](https://github.com/hungmk88/gani-platform-chat/pull/313) | test(api): dấu hiệu rò rỉ không còn trùng traceId ngẫu nhiên (db-7 → db-seven) |
| [#308](https://github.com/hungmk88/gani-platform-chat/pull/308) | feat(worker): gắn khách vào hội thoại khi nhận tin Zalo (CRM b, N165) |
| [#316](https://github.com/hungmk88/gani-platform-chat/pull/316) | feat(api): GET /v1/customers và /v1/customers/{id}, che SĐT/email với Marketing/Viewer (CRM c2b, N165) |
| [#321](https://github.com/hungmk88/gani-platform-chat/pull/321) | feat(api): PATCH /v1/customers/{id}, sửa hồ sơ khách, SĐT lưu E.164 (CRM d, N165) |

Ghi chú:
- Một số PR đầu session (claim/transfer/close, InboundProcessor, consumer, SecretBox/ZaloAdapter, `outbox_stats`) merge trước khi commit có dòng `Claude-Session`, nên không có trong bảng trên. Chúng vẫn nằm trong danh sách task 1–53.
- Các PR xếp chồng (stacked) được squash cùng PR trên cùng, nên một số số PR (#307, #312, #314) không có commit riêng trên `main`.

## 5. Quyết định đã ghi (`QUESTIONS.md`)

| Mã | Nội dung |
|---|---|
| N128–N131 | Review D-04/D-06, DB-01 (`users.status`), `outcome` khi đóng (`resolved`/`no_response`/`spam`), `list-sessions` còn trả token |
| N132–N136 | Mã lỗi snake_case; phạm vi "Team" của Sales/Support; Idempotency-Key; lý do chuyển; CSRF theo Origin |
| N137 | `memberships_for_user` gắn `auth_user_id` |
| N138–N144 | Lát dọc: gói conversations, kênh Zalo, webhook, consumer, Socket.IO `/agent`, Valkey |
| N145, N146 | `GET /v1/me`; agent trả lời khách |
| N147–N151 | Lời mời, bootstrap operator, email, `tenant:create-org`, nhận lời mời một bước |
| N152–N156 | Mời/gửi lại lời mời, danh sách thành viên, đổi vai trò, đặt lại 2FA, giới hạn tải |
| N157–N161 | Workspace, `tenant:create-workspace`, thành viên workspace, team, team ↔ kênh |
| N162 | Tài khoản cá nhân: hồ sơ, đổi mật khẩu, quên/đặt lại mật khẩu |
| N163 | Mẫu trả lời nhanh (C7) |
| N164 | `contactPhone` trong `/v1/me` (em tự chốt) |
| N165 | CRM lõi (em tự chốt). **Lệch Brief:** khóa định danh có thêm OA, vì UID Zalo theo OA |
| N166 | Phản hồi Backend gói 30/10. **Chờ anh duyệt** trước khi gửi FE |

## 6. Trạng thái hiện tại

**PR đang mở:**
- [#323](https://github.com/hungmk88/gani-platform-chat/pull/323): `docs(ui)` phản hồi Backend 30/10. Anh duyệt nội dung rồi merge và gửi FE.

**CI:** `main` xanh ở `c4ffd30` (#320); lần chạy cho `b2cb50c` (#321) đang chạy lúc lập báo cáo.

**Lỗi test chập chờn, chưa tìm ra gốc:**

| Test | Nơi gặp | Dữ kiện |
|---|---|---|
| `inbound-e2e.spec.ts` K-IN (kill -9) | CI `main` `9bbec46` | Outbox đã publish đủ 1015 sự kiện, consumer im từ giây thứ ~20 tới hết 75 giây; commit kế tiếp xanh |
| `quick-replies.spec.ts` (admin e2e) | CI `main` `7b50b80` | Chữ gõ ô tag rơi vào ô nội dung; ở máy chạy lại xanh |
| `realtime-handshake` "sixth socket" | Máy local, 2 lần | Chỉ khi chạy cả chuỗi kiểm sau db-int; chạy lại 6 lần liền đều xanh; chưa thấy trên CI |

**Chờ quyết định:**
- **Q7** (giờ làm việc, team, số agent): chặn SLA, phân bổ, ngoài giờ.
- **CEO:** U27, U28, U29, U35, U42, U43, U49, U50.

## 7. Việc tiếp theo đề xuất

| Hạn | Việc |
|---|---|
| Trước 30/10 | U34 (OpenAPI uuid rỗng), U38 (`POST /v1/quick-replies/preview`), U48 (tìm khách theo email trùng khớp) |
| Trước S1 (16/11) | U30: `channel`, `lastMessagePreview`, `assignee` trong dòng Hộp thư; U31: `GET /v1/conversations/{id}/assignees` |
| Sau | Tag (J4), trường tùy chỉnh (J1), gộp khách (J3), ghi chú nội bộ (`/notes`), quản lý kênh (U26, cần Q6), lead/ticket (M06) |

## 8. Bảo mật

- Không có secret nào trong commit hay tài liệu: gitleaks 0 trước mỗi lần push, quét `npg_|sk-|AIza|AKIA|ghp_|PASSWORD=` không có kết quả mới.
- Không kết nối production, không deploy, không chạy seed ngoài môi trường test; mọi DB dùng là Postgres local tạm của session.
- Không log PII:
  - audit đổi khách chỉ ghi tên trường;
  - `support_role` không đọc tên/SĐT/email/UID;
  - lỗi chỉ log mã.
