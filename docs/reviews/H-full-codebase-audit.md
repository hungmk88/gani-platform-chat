# Báo cáo Full Codebase Audit — gani-platform-chat

- **Commit audit:** `de0fd52` (`main`, 12/10/2026); **cập nhật 19/10/2026 theo `main` = `acb0335`** (xem mục "Cập nhật 19/10" dưới đây).
- **Phương pháp:** đọc mã theo luồng; chạy toàn bộ lint/typecheck/test/audit; chạy test tích hợp trên PostgreSQL 16 + Redis cục bộ; truy vấn catalog DB; tái hiện lỗi qua HTTP với API build thật; 13 đột biến (mutation) trên worktree riêng; đo tải và CPU profile; quét secret toàn lịch sử. Nhật ký chi tiết từng phase (lệnh, số liệu, bằng chứng) nằm ngoài repo; các điểm chính được trích trong báo cáo này.
- **Độ tin cậy:** CONFIRMED = có bằng chứng chạy được hoặc trích dẫn trực tiếp; LIKELY; POTENTIAL; NOT VERIFIED.


### Cập nhật 19/10/2026 (rà soát tồn đọng theo `main` = `acb0335`)

| Thay đổi trên `main` từ `de0fd52` | Ảnh hưởng tới báo cáo |
|---|---|
| #113 `fix(db): let the database set received_at` | **F-02 đóng**: đã kiểm, `NewInboundEvent` không còn `receivedAt`; db integration 669/669 xanh trên DB mới |
| #114 docs refresh (README, ADR, `CLAUDE.md`, quy tắc kích thước PR) | Không đổi phát hiện nào của báo cáo này |
| #108–#112 tài liệu/prototype UI | Không ảnh hưởng mã chạy |

- Mã auth, tenant, outbox, migration **không đổi** → DB-01, SEC-01, SEC-02, SEC-03 và các mục khác **vẫn mở**.
- Kiểm lại trên `acb0335`: build, lint, typecheck, `pnpm test` (466 + 33) đều exit 0; db integration 669/669, api integration 64/64 (DB mới).
- Phát hiện mới: **TEST-01** (P3).
- PR mở duy nhất **#3** (`feat/pr3b0-tenant-context`, 02/10/2026): mọi file của nó đã có trên `main` ở dạng mới hơn → đề nghị anh đóng PR.

---

## A. Executive Summary

**Hiện trạng.** Repo đang ở **Sprint 1 — nền móng**. Phần đã có (đa tenant với RLS, xác thực + 2FA, máy trạng thái hội thoại, outbox → BullMQ, kho inbound, bảo trì partition) được làm **cẩn thận và có kiểm chứng tốt**:
- Mọi kiểm tra đều xanh: 466 unit (+33 test lint migration), 753 integration, lint, typecheck, migration lint, audit 0 lỗ hổng.
- Đột biến 13/13 bị test bắt.
- Không có secret nào trong 146 commit.

**Nhưng sản phẩm chưa tồn tại.** Chưa có luồng chat nào chạy từ đầu đến cuối, chưa có AI, kênh, widget, admin UI, realtime, cách tạo user, hay hạ tầng triển khai.

**Ba rủi ro lớn nhất (đều đã tái hiện):**
1. **DB-01** — User đã soft-delete vẫn đăng nhập, giữ phiên, qua middleware tenant **và vượt cổng 2FA**.
2. **SEC-01** — Khi một truy vấn DB lỗi, Better Auth in nguyên SQL + tham số ra log. Em đo được: **session token xuất hiện trong log**. Token lại lưu thô trong DB (C-02), nên đây là credential dùng được ngay.
3. **SEC-02 (= C-01)** — Giới hạn tốc độ đăng nhập bị né bằng cách đổi `X-Forwarded-For`: 14/14 lần không bị 429.

**Ảnh hưởng trực tiếp đến vận hành:**
- Chưa có Dockerfile, IaC, pipeline deploy, backup/PITR (OPS-01).
- Chưa có metrics hay health cho worker (OPS-02).
- Runner migration không chạy được `CREATE INDEX CONCURRENTLY` và không có `lock_timeout`, nên có thể khóa bảng khi deploy (DB-03).

**Sẵn sàng production:** **Chưa.** Có 6 mục P1. Ba trong số đó là phần chưa xây (AR-01, DB-02, OPS-01), không phải lỗi của code đã có.

**Chưa đủ bằng chứng để đánh giá:**
- AI/LLM, prompt, ResponseGuard: không có code.
- Hạ tầng cloud: chưa chọn.
- Hành vi trên Valkey 8 / pgvector thật: em dùng Redis 7 và Postgres không có pgvector.
- Bảng chuyển trạng thái `transitions.ts` chưa được đối chiếu từng dòng với Brief P14.

---

## B. Repository Inventory

### Tech stack (đã xác minh)

| Thành phần | Công nghệ |
|---|---|
| Ngôn ngữ / runtime | TypeScript 6.0.3, Node 22 (ESM) |
| Monorepo | pnpm 9.15 workspace + Turborepo 2.11 |
| API | NestJS 12.1 (Express 5) |
| Xác thực | Better Auth 1.7.7, Argon2id |
| Database | PostgreSQL 16, `pg` 8.23, Drizzle 0.45.3, SQL migration viết tay |
| Hàng đợi | BullMQ 5.81 trên Valkey 8 |
| Test | Vitest 5 |
| CI | GitHub Actions, 4 job: `verify`, `security`, `db`, `queue` |

### Trạng thái từng thành phần

| Thành phần | Trạng thái |
|---|---|
| `apps/api` | Một phần: health, `/api/auth/*`, `GET /v1/me/security-status`; module hội thoại có code nhưng **chưa gắn vào `AppModule`** |
| `apps/worker` | Một phần: outbox relay, job bảo trì partition; **chưa có consumer** |
| `packages/db` | Chính: 50 migration, RLS, store functions |
| `packages/domain` | Có: UUIDv7, FSM thuần |
| `packages/config` | Có |
| `apps/admin`, `apps/widget`, `packages/ai-core`, `packages/channels`, `packages/ui`, `packages/testing`, `prompts/`, `evals/` | **Chưa triển khai** |
| `infra/` | Chỉ có docker-compose dev và SQL bootstrap role |
| `prototype/dot1` | HTML/JS tĩnh, không nối backend |

### Đã review

- Toàn bộ mã nguồn `apps/api/src`, `apps/worker/src`, `packages/db/src` (store, tenant, pool), `packages/domain/src/conversation/decide.ts`.
- Cấu hình: ESLint, Turbo, CI, hook pre-commit, `.claude/settings.json`.
- Catalog DB đầy đủ (RLS, policy, grant theo cột, hàm, ràng buộc, index, trigger).
- Runner migration; một phần migration đọc tay.
- Quét lịch sử git; prototype (bằng quét).
- Docs: README, các `CLAUDE.md`, ADR-002, `docs/reviews/00-summary.md`, `infra/CLAUDE.md`.

### Chưa review (và lý do)

- **44/50 migration chưa đọc từng dòng:** em thay bằng kiểm trạng thái cuối trên catalog. Đủ cho quyền, RLS, ràng buộc; chưa soát khối `-- rollback:`.
- **`transitions.ts`, `snapshot.ts`, `types.ts`:** đã có test và đột biến M04 bảo vệ, nhưng chưa đối chiếu từng dòng với Brief P14.
- **111 file test:** đánh giá qua mutation, số liệu thống kê và đọc mẫu; không đọc hết.
- **Tài liệu dài:** Brief v1.0 (1 063 dòng), phụ lục, 7 spec, `QUESTIONS.md` (160 KB) — chỉ tra cứu theo điểm, không đọc toàn bộ.
- **AI, kênh, widget, admin, IaC:** không tồn tại trong repo.

---

## C. Architecture Report

### Sơ đồ hiện trạng

```
HTTP ─► [2FA gate] ─► /api/auth/* (Better Auth, pool auth_role)
                  └─► JSON parser ─► /v1/* [tenant middleware: session → org → member (RLS)]
                                         └─► Nest router (health, me)
                       (ConversationsModule: FSM + MessageService + OutboxWriter — CHƯA GẮN)
PostgreSQL 16: RLS fail-loud qua app.current_org / app.current_workspaces (SET LOCAL trong transaction)
apps/worker: OutboxRelay ─► BullMQ q.events.ws.<id> ─► (KHÔNG có consumer)
             PartitionMaintenanceJob (02:00 VN mỗi ngày)
```

### Đánh giá

- **Giữ nguyên:**
  - Biên giữa các gói được ESLint ép.
  - 0 vòng phụ thuộc trên 91 file.
  - FSM thuần trong `packages/domain`, cộng CAS ở DB.
  - Outbox cùng transaction với dữ liệu; relay at-least-once, chống trùng bằng `jobId`.
  - RLS fail-loud, khóa ngoại ghép `(org_id, …)`, hàm `SECURITY DEFINER` đã khóa `search_path`.
  - Cấu hình worker fail-fast; logger worker chỉ nhận trường cho phép.
- **Vấn đề kiến trúc có tác động thực tế:**
  - Thiếu khung chung ở rìa API: không có exception filter, không header bảo mật, không config tập trung, không logger có cấu trúc (AR-03, AR-04, AR-07, AR-08).
  - Thứ tự khóa mới chỉ là quy ước (AR-05).
  - SQL của phần auth nằm ngoài `packages/db` (AR-06).
- **Nguyên nhân gốc:** xây nền theo chiều ngang (từng khối thật kỹ) trước chiều dọc (một luồng chạy hết). Rủi ro tích hợp vì thế dồn về sau.
- **Đề xuất:**
  - **Sửa và refactor có kiểm soát; không cần thiết kế lại.**
  - Ưu tiên một "vertical slice" mỏng sớm: webhook → inbound → message → outbox → consumer → realtime.
- **Độ phức tạp:** chú thích và mã N-số rất dày, nên tốn công đọc hiểu cho người mới. Đây là chi phí bảo trì, không phải lỗi.

---

## D. Findings Register

Sắp theo mức độ. "Cũ" = đã có trong `docs/reviews`, em kiểm lại độc lập và vẫn đúng.

| ID | Sev | Conf | File/Line | Vấn đề | Tác động | Giải pháp |
|---|---|---|---|---|---|---|
| **DB-01** | **P1** | CONFIRMED | `apps/api/src/modules/auth/revoking-adapter.ts:53`; `migrations/202610031910_create_memberships_for_user.sql`; `apps/api/src/modules/auth/two-factor.ts:44` | User đã soft-delete vẫn đăng nhập, qua middleware tenant, vượt cổng 2FA (không thấy user = "không cần 2FA") | Người bị thu hồi quyền vẫn đọc dữ liệu khách hàng; 2FA fail-open | Lọc `deleted_at` trong adapter; JOIN `users` trong `memberships_for_user`; cổng 2FA fail-closed; thu hồi phiên khi xóa user |
| **SEC-01** | **P1** | CONFIRMED | `apps/api/src/modules/auth/auth.config.ts:52-137` (không cấu hình logger) | Lỗi DB → Better Auth log `DrizzleQueryError` kèm params (session token, email) | Lộ credential và PII vào log | Logger tùy biến chỉ ghi mã lỗi; bọc adapter để làm sạch lỗi; băm token (C-02) |
| **SEC-02** (= C-01, cũ) | **P1** khi có proxy | CONFIRMED | `apps/api/src/modules/auth/auth.config.ts:47` | Rate limit đăng nhập tin `X-Forwarded-For` của client | Password spraying không bị giới hạn theo IP | Chốt topology (N112), `trustedProxies`, giới hạn theo email, store dùng chung |
| **AR-01** | **P1** (go-live) | CONFIRMED | `apps/api/src/app.module.ts:7` | Không có luồng chat end-to-end; AI, kênh, realtime, UI chưa có | Chưa có sản phẩm để vận hành | Vertical slice |
| **DB-02** | **P1** (go-live) | CONFIRMED | Không có `app.accept_invite`, không có script bootstrap | Không có cách tạo user/org | Môi trường mới không ai đăng nhập được | PR7 (invite) + script bootstrap có chặn |
| **OPS-01** | **P1** (go-live) | CONFIRMED | `infra/` | Không Dockerfile, IaC, deploy, backup/PITR | Không triển khai lặp lại được; RPO/RTO chưa kiểm chứng | Chốt Q2 → hạ tầng tối thiểu |
| AR-03 | P2 | CONFIRMED | `curl /nope`; không có global filter | Định dạng lỗi không thống nhất; lỗi domain 404/409 sẽ thành 500 | Hợp đồng API sai khi thêm endpoint | Global exception filter → RFC 9457 |
| AR-04 / SEC-04 | P2 | CONFIRMED | Mọi response | `X-Powered-By: Express`; không HSTS, `nosniff`, chống nhúng khung; CORS chưa khai báo | Thiếu một lớp phòng thủ | Header bảo mật ở rìa |
| SEC-03 | P2 | CONFIRMED | Response sign-in, `get-session` | Token phiên trả trong JSON | XSS lấy được token, `HttpOnly` mất tác dụng | Hook loại `token` khỏi body |
| C-02 (cũ) | P2 (nâng từ LOW) | CONFIRMED | `sessions.token` | Token lưu thô | Kết hợp SEC-01 thì nặng hơn | Băm token |
| DB-03 | P2 | CONFIRMED | `packages/db/scripts/migrate.mjs:70` | Không chạy được `CONCURRENTLY`; không `lock_timeout` | Khóa bảng khi deploy | Chế độ no-transaction cho từng file; đặt timeout |
| AR-02 | P2 | CONFIRMED | `apps/worker/src/relay/outbox-relay.ts:188` | Relay chạy khi chưa có consumer | Valkey và outbox ùn | Cờ bật/tắt relay; consumer tối thiểu |
| AR-05 | P2 | POTENTIAL | `packages/db/src/conversation-store.ts:104` | `applyTransition` không lấy advisory lock | Deadlock khi có đường "claim rồi gửi tin" | Lấy lock trước UPDATE |
| OPS-02 | P2 | CONFIRMED | `apps/*` | Không metrics/tracing; worker không có health | Không cảnh báo được sự cố | Health, metrics tối thiểu |
| F-04 (cũ) | P3 | CONFIRMED | `app.channel_account_for_webhook` | `app_role` lấy được secret đã mã hóa của mọi tenant nếu biết id | Mở rộng bề mặt | Thu hẹp hàm (N124) |
| DB-04 | P3 | CONFIRMED | Policy `conversations`/`messages` | Fail-loud khi thiếu workspace phụ thuộc dữ liệu | 0 dòng im lặng ở code mới | Kiểm cả hai biến ngữ cảnh trong một hàm |
| DB-05 | P3 | CONFIRMED | Grant theo cột | `app_role` UPDATE cả cột định danh (`id`, `org_id`, `workspace_id`…) | Trái least privilege | Thu hẹp grant |
| DB-06 | P3 | CONFIRMED | `messages` | Thiếu FK `sender_user_id`, CHECK agent ⇔ user, giới hạn độ dài | Dữ liệu sai từ đường ghi khác | FK + CHECK |
| AR-06 | P3 | CONFIRMED | 4 file trong `apps/api/src/modules/auth` | SQL thô ngoài `packages/db` (trái ADR-002) | Bề mặt review bị tách đôi | Gom về `packages/db` |
| AR-07 | P3 | CONFIRMED | `apps/api/src/modules/database/database.module.ts:9` | Config API không fail-fast | Chạy nửa vời khi thiếu biến | Module config như worker |
| AR-08 | P3 | CONFIRMED | `apps/api` | Log không cấu trúc, không `traceId` | Khó truy vết sự cố | Logger JSON chung |
| PERF-01 | P3 | CONFIRMED (đo) | gate + middleware | 9 SQL + ~3 ms CPU mỗi request; ~300–370 req/s mỗi tiến trình | Chi phí nền cao | Nhiều tiến trình; gộp truy vấn |
| SEC-05 | P3 | POTENTIAL | `apps/api/src/modules/request-context/two-factor.gate.ts:61` | `/v1` không rate limit; mỗi phiên tốn DB | Cạn pool auth | Rate limit ở edge |
| BE-01 | P3 | POTENTIAL | `/v1` | Không kiểm Origin cho request ghi | CSRF khi có POST | Middleware Origin |
| BE-02 | P3 | NOT VERIFIED | — | Chưa có khung validation, Idempotency-Key, OpenAPI | Mỗi endpoint làm một kiểu | Chốt trước endpoint đầu tiên |
| AR-10 | P3 | CONFIRMED | `apps/worker/src/relay/outbox-relay.ts:166` | Backpressure mất trí nhớ sau restart | Vượt ngưỡng tối đa một batch | Suy ra queue từ workspace |
| OPS-03 | P3 | CONFIRMED | — | Chưa có quy trình migrate/rollback trong pipeline | Deploy rủi ro | expand → migrate → contract |
| OPS-04 | P3 | CONFIRMED | `apps/api/src/modules/auth/auth.config.ts:124` | Rate limit lưu trong RAM | Sai khi scale ngang | Store Valkey |
| TEST-01 | P3 | CONFIRMED | `packages/db/test/outbox-relay.spec.ts`, `packages/db/test/partitions.spec.ts` | Test tích hợp không chạy lại được trên DB đã dùng: DB tạm sau 1 tuần → 7 ca đỏ (`app.outbox_pending_orgs` thấy org của lần chạy trước; ca 9c giả định partition tháng sau chưa có); DB mới tinh → 669/669 xanh | README hướng dẫn chạy trên DB dev dùng lại → dev thấy đỏ giả, dễ bỏ qua đỏ thật | Test tự dọn/lọc theo org của chính nó; ca 9c chọn tháng chưa tồn tại |
| E-02 (cũ) | P3 | CONFIRMED | `packages/db/src/outbox-store.ts:390` | `failOutboxEvent` không kiểm `attempts` | Relay cũ có thể fail claim của relay mới | Giống `inbound-store` |
| AR-11, AR-12, DB-07, DB-08, SEC-06, SEC-07, OPS-05, OPS-06, PERF-02, B-03 (cũ) | INFO | CONFIRMED | — | Cờ `app.fsm` do app tự bật được; org rơi về org khác âm thầm; giá Zalo tạm trong migration; `users` không RLS; stack trace trong log; chưa có Dependabot/branch protection; checklist lỗi thời; shutdown tốt; `MAX()+1`; support đọc nội dung tin | Theo dõi | — |

**Tổng (sau khi khử trùng lặp):**

| Mức | Số lượng |
|---|---|
| P0 | 0 |
| P1 | 6 (3 là lỗi bảo mật trong code, 3 là phần chưa xây) |
| P2 | 8 |
| P3 | 16 |
| INFO | 10 |

---

## E. Security Report

**Lỗ hổng đã xác minh (tái hiện được):**

| ID | Mô tả ngắn | Cách tái hiện |
|---|---|---|
| DB-01 | User soft-delete truy cập dữ liệu + vượt 2FA | sign-in 200; `/v1` qua; owner bị xóa không bị 403 |
| SEC-01 | Session token và email vào log khi DB lỗi | Thu quyền `SELECT sessions` → log chứa token |
| SEC-02 | Né rate limit bằng `X-Forwarded-For` | 14×401, không 429 |
| SEC-03 | Token phiên trong JSON | Đọc body response |
| SEC-04 | Thiếu header bảo mật | Đọc header response |

**Đã kiểm và đạt:**
- Không có secret trong lịch sử git (gitleaks 8.30.1, có đối chiếu checksum).
- CSRF trên Better Auth: Origin lạ hoặc thiếu Origin → 403.
- Cookie `HttpOnly` + `SameSite=Lax`.
- `switch-org` không lộ org nào tồn tại.
- `org_id` không bao giờ lấy từ client.
- Dò user qua thời gian đăng nhập: chênh ~5 ms, cùng thông điệp.
- Argon2id, khóa tài khoản, TOTP không có "nhớ thiết bị".
- RLS ENABLE + FORCE trên 18 bảng.
- 9 hàm `SECURITY DEFINER` đã khóa `search_path`.
- Chuỗi cung ứng CI: quyền đọc, action ghim SHA, lockfile có `integrity`, audit 0.

**Cần xác minh thêm:**
- C-01/SEC-02 theo topology proxy thật.
- F-04, B-03 (quyết định chính sách).
- Toàn bộ bề mặt AI, webhook, upload, frontend: chưa có code.

**Khuyến nghị:**
- Sửa DB-01 và SEC-01 trước khi có bất kỳ dữ liệu thật nào.
- Chốt N112 trước go-live.
- Đặt khung bảo mật ở rìa API (filter, header, Origin, rate limit) trước endpoint nghiệp vụ đầu tiên.

---

## F. Quality & Test Report

| Lệnh | Exit | Kết quả |
|---|---|---|
| `pnpm build` / `smoke` / `lint` / `typecheck` / `format:check` / `lint:migrations` | 0 | |
| `pnpm test` | 0 | 466 test Vitest + 33 test lint migration; độ phủ dòng: domain 100%, db 100%, worker 98.67%, api 94.93% |
| `pnpm audit --audit-level=high` | 0 | 0 lỗ hổng |
| `@gani/db` test:integration (PG16 cục bộ) | 0 | 666 test |
| `@gani/api` test:integration | 0 | 64 test |
| `@gani/worker` test:integration (Redis 7 + shim cho lệnh `docker`) | 0 | 23 test |
| Mutation thủ công | — | 13/13 bị bắt; M08 và M13 chỉ bị test tích hợp bắt |

**Lỗ hổng kiểm thử:** chưa có test cho user bị xóa (DB-01), thiếu workspace khi org rỗng (DB-04), log khi DB lỗi (SEC-01), token trong body (SEC-03), và header bảo mật. 33 chỗ trong test chờ bằng thời gian. Test tích hợp không chạy trong `pnpm test` cục bộ.

**Luồng nghiệp vụ chưa xác minh** (vì chưa tồn tại): nhận tin từ kênh, bot/AI trả lời, chuyển cho người, realtime, báo giá (ResponseGuard), mời user.

---

## G. Performance & Operations

- **Đã đo (sandbox 4 vCPU, 1 tiến trình):**
  - `/healthz`: 5 407 req/s.
  - `/v1` có phiên: ~300–370 req/s; p50 65 ms ở 20 kết nối, 303 ms ở 100 kết nối.
  - Bị giới hạn bởi CPU của Node. Mỗi request chạy 9 lệnh SQL.
  - Không suy ra được năng lực production từ các số này.
- **Rủi ro vận hành:**
  - Không có hạ tầng triển khai, backup hay giám sát.
  - Migration có thể khóa bảng.
  - Relay chạy khi chưa có consumer.
  - Rate limit lưu trong RAM.
  - Log lộ token (SEC-01).
- **Phép đo còn thiếu:**
  - Tải trên luồng ghi tin, claim và relay với dữ liệu lớn.
  - Kích thước partition theo thời gian.
  - Hành vi khi failover DB/Valkey trên hạ tầng thật.
  - Thời gian khôi phục (RTO).
  - Bộ nhớ Valkey khi hàng đợi đầy.

---

## H. Remediation Plan

Độ khó: S ≤ 1 ngày · M 2–4 ngày · L ≥ 1 tuần. Mỗi việc là một PR ≤ 400 dòng theo quy tắc repo.

### 1. Việc cần làm ngay (trước mọi môi trường có dữ liệu thật)

| Việc | Phạm vi | Dependency | Độ khó | Tiêu chí xong | Cách kiểm chứng |
|---|---|---|---|---|---|
| **Sửa DB-01** | adapter bọc lọc user đã xóa; migration `memberships_for_user` JOIN `users`; cổng 2FA fail-closed; thu hồi phiên khi xóa user | không | M | User bị xóa: sign-in 401; phiên cũ → `/v1` 401; owner bị xóa không vượt gate | Integration test mới + lặp lại cách tái hiện ở Phase 3 |
| **Sửa SEC-01** (+ băm token C-02) | `logger` của Better Auth chỉ ghi mã lỗi; làm sạch lỗi DB ở adapter; băm `sessions.token` | thống nhất N113 | M | Lỗi DB giả lập → log không có token/email | Test grep log; lặp lại cách tái hiện Phase 4 |
| **SEC-03 + AR-04** | hook loại `token` khỏi body; tắt `x-powered-by`; thêm header bảo mật | không | S | Body không có `token`; có HSTS/nosniff/frame header | HTTP test |

### 2. Sửa lỗi quan trọng

| Việc | Dependency | Độ khó | Tiêu chí xong |
|---|---|---|---|
| SEC-02: chốt topology N112, `trustedProxies`, giới hạn theo email | anh chốt topology | M | Đổi XFF vẫn bị 429 |
| AR-03: global exception filter RFC 9457 | không | S | Lỗi 404/409/500 đều ra problem+json, có `traceId` |
| DB-03: runner hỗ trợ no-transaction, `lock_timeout` + retry | không | M | Chạy được file `CONCURRENTLY`; khóa bị giữ → runner lỗi sau timeout |
| AR-05: `applyTransition` lấy advisory lock | không | S | Test claim+append song song với tin khách: không có 40P01 |
| AR-02: cờ bật/tắt relay | không | S | Relay mặc định tắt ở môi trường chưa có consumer |
| DB-04, E-02, TEST-01 | không | S mỗi việc | Test tương ứng |

### 3. Refactor có kiểm soát

AR-06 (gom SQL auth về `packages/db`), AR-07 (config fail-fast cho API), AR-08 (logger JSON chung), DB-05 (thu hẹp grant UPDATE), DB-06 (FK/CHECK cho `messages`), BE-01/BE-02 (Origin, validation, Idempotency-Key, OpenAPI — trước endpoint `/v1` đầu tiên).
- **Tiêu chí:** lint/grep chứng minh không còn `pool.query` ngoài `packages/db`; `has_column_privilege` trả false cho cột định danh; test 23503/23514 cho ràng buộc mới.

### 4. Cải thiện test và vận hành

- Test cho các điểm mù: DB-01, DB-04, SEC-01, SEC-03, header.
- Unit test cho ngưỡng khóa tài khoản và quy tắc admin phải bật 2FA (M08, M13).
- OPS-02: health/heartbeat cho worker; metrics outbox (pending, dead-letter, độ trễ).
- OPS-03: quy trình migrate trong pipeline.
- Bật Dependabot.
- Viết checklist go-live thật thay cho OPS-05.
- Lặp lại bộ đo tải của Phase 5 như mốc hồi quy.

### 5. Tối ưu dài hạn

- **AR-01:** vertical slice end-to-end (L), rồi kênh, AI và ResponseGuard theo Brief.
- **DB-02:** invite + script bootstrap (M).
- **OPS-01:** hạ tầng theo Q2, backup/PITR + diễn tập restore (L).
- **PERF-01:** giảm số truy vấn mỗi request, chạy nhiều tiến trình.
- **OPS-04:** rate limit dùng store Valkey.
- Đánh giá AI/LLM security khi `packages/ai-core` có code.

---

## I. Final Verdict

- **Codebase hiện tại có đáng tin cậy không?**
  **Có, cho phạm vi đã xây.** Bằng chứng: mọi kiểm tra xanh, đột biến 13/13 bị bắt, catalog DB đúng thiết kế đa tenant, không có secret.
  Ngoại lệ là ba lỗi bảo mật đã tái hiện (DB-01, SEC-01, SEC-02) nằm ở chỗ giao giữa Better Auth và dữ liệu của mình. Đây là vùng bộ test hiện tại không phủ.

- **Rủi ro lớn nhất?**
  1. Truy cập sau khi bị thu hồi quyền, kèm vượt 2FA (DB-01).
  2. Credential lọt vào log (SEC-01 + C-02).
  3. Brute-force đăng nhập phụ thuộc topology proxy (SEC-02).
  4. Về tổng thể: phần lớn sản phẩm chưa được xây, nên rủi ro tích hợp còn ở phía trước.

- **Có thể triển khai production chưa?**
  **Chưa.** Không có luồng nghiệp vụ, không có cách tạo user, không có hạ tầng hay backup, và còn 3 lỗi bảo mật P1. Các thành phần nền thì đủ chất lượng để xây tiếp lên trên.

- **Sửa code hiện tại hay tái cấu trúc?**
  **Sửa và refactor có kiểm soát.** Không có bằng chứng nào cần thiết kế lại. Nên chuyển nhịp sang xây một luồng dọc sớm, để lộ rủi ro tích hợp.

- **Ba việc giá trị cao nhất cần làm trước:**
  1. **Sửa DB-01** (user bị xóa + 2FA fail-closed), có test.
  2. **Sửa SEC-01 cùng băm token phiên (C-02)**, có test kiểm log.
  3. **Đặt khung bảo mật ở rìa API trước endpoint nghiệp vụ đầu tiên:** SEC-03 + AR-04 + AR-03 + chốt N112 cho SEC-02.

Em không chấm điểm tổng thể vì chưa có bộ tiêu chí được thống nhất.
