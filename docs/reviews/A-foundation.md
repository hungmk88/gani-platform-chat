# Code Review — Nhóm A: Nền móng (config, domain, kết nối DB, CI, kho mã)

- **Mốc code:** `main` = `a443721` (M1.3 PR4b-1). PR4b-2a (`efce039`) và mọi thứ sau đó **ngoài mốc**.
- **Ngày rà soát:** 12/10/2026. **Người rà soát:** Claude (chính tác giả phần lớn mã, xem mục "Giới hạn").
- **Phạm vi:** `packages/config/*`, `packages/domain/src/*`, `packages/db/src/{pool,tenant-context,tenant-tx,validate,auth-tx,auth-db,member-context}.ts`, `infra/*`, `.github/workflows/ci.yml`, `.githooks/*`, `turbo.json`, `package.json` gốc, `.gitignore`, `.env.example`, `pnpm-lock.yaml`.
- **Cách tìm bằng chứng:** `git grep -n <mẫu> a443721 -- <đường dẫn>`, `git show a443721:<file>`, chạy lệnh thật trên cây = `a443721`. Dẫn chứng ghi `đường-dẫn:dòng`.

## Tóm tắt

| Mức | Số | Mã |
|---|---|---|
| CRITICAL | 0 | — |
| HIGH | 1 | A-01 |
| MEDIUM | 1 | A-02 |
| LOW | 0 | — |
| INFO | 5 | A-03 … A-07 |

**Điều cần anh quyết trước: A-01.** API build qua `tsc` nhưng **không khởi động được** bằng `node dist/main.js`; mọi test vẫn xanh vì vitest tự dịch TypeScript. Chưa chạm dữ liệu hay bảo mật, nên không phải CRITICAL theo thang đã thống nhất.

---

## Phát hiện

### [HIGH] A-01 — `@gani/domain` chỉ xuất mã TypeScript, API build xong nhưng không chạy được
- **File:** `packages/domain/package.json:6-8`; nơi dùng lúc chạy: `apps/api/src/modules/auth/auth.config.ts:2`, `apps/api/src/modules/conversations/conversation-state-machine.ts:22`, `apps/api/src/modules/conversations/message-service.ts:10`, `apps/api/src/modules/conversations/outbox-writer.ts:2`.
- **Nhóm:** A (nền móng) — ảnh hưởng C, D.
- **Mô tả:** `exports` của `@gani/domain` trỏ vào `./src/index.ts`. `apps/api` import giá trị (không chỉ kiểu) từ gói này, nên bản `dist/` của API vẫn `import '@gani/domain'` và Node nạp thẳng `src/index.ts`. Mã nguồn đó dùng đuôi `.js` cho import tương đối (đúng quy ước ESM), nhưng trên đĩa chỉ có `.ts`, nên Node không tìm thấy file. `tsc` (lệnh `build`) không báo lỗi vì tìm được `.ts` qua cơ chế phân giải kiểu. Hậu quả: `pnpm --filter @gani/api build` **xanh**, còn `node dist/main.js` (cũng là `pnpm start`, và `apps/api/scripts/dev.mjs` chạy `node --watch dist/main.js`) **chết ngay lúc nạp**. Bản triển khai nào dùng artefact build đều hỏng.
- **Bằng chứng:**
  ```
  $ pnpm --filter @gani/api build          # tsc -p tsconfig.build.json → thoát 0
  $ cd apps/api && node dist/main.js
  Error [ERR_MODULE_NOT_FOUND]: Cannot find module '...\packages\domain\src\conversation\index.js'
    imported from ...\packages\domain\src\index.ts
  ```
  - Chạy ngày 12/10/2026 trên cây làm việc = `a443721`.
  - Nguồn gốc: commit `e2c3f9f` (2026-10-05, #23) thêm `import { uuidv7 } from '@gani/domain'` vào `auth.config.ts`.
  - CI không bắt được: job `verify` chạy `pnpm build` (`ci.yml:42`) nhưng không có bước nào khởi động `dist/main.js` của API. Kill-test của worker có chạy `node dist/main.js` (`ci.yml:194-196`), và worker **không** import `@gani/domain` (quy tắc ESLint cấm), nên không lộ.
  - Ghi chú cũ lệch: N61 còn ghi "chưa ai import ở `apps/api`", đã sai từ #23.
- **Đề xuất:** (không sửa trong PR docs) một trong hai hướng, anh chọn: (1) cho `@gani/domain` build ra `dist/` và đổi `exports` sang `dist` kèm `types`, thêm `dependsOn: ["^build"]` nếu cần trong `turbo.json`; hoặc (2) giữ nguồn `.ts` và cho API chạy bằng trình nạp TS (không nên cho sản xuất). Bất kể hướng nào, thêm **một bước smoke vào CI**: build, khởi động `node apps/api/dist/main.js` với `DATABASE_URL_*` giả, gọi `GET /health` rồi tắt — đây mới là chỗ bắt được lớp lỗi này. Cập nhật N61. Fix làm ở PR riêng, qua Plan Mode.
- **Mức độ:** HIGH

### [MEDIUM] A-02 — Không có `statement_timeout`, `idle_in_transaction_session_timeout`, `lock_timeout` ở bất kỳ đâu
- **File:** `packages/db/src/pool.ts:11-16`, `infra/db/bootstrap-roles.sql`, `packages/db/src/message-store.ts:58`.
- **Nhóm:** A — ảnh hưởng F (kho tin nhắn), E (relay).
- **Mô tả:** Pool chỉ đặt `connectionTimeoutMillis: 5_000` (thời gian chờ nhận kết nối). Không có giới hạn thời gian cho một câu lệnh, cho một transaction đang rảnh, hay cho việc chờ khóa. `insertMessage` lấy `pg_advisory_xact_lock(hashtext(conversation_id))` rồi chờ không hạn định; một transaction giữ khóa mà bị treo (ví dụ lỗi ở tầng gọi, mạng đứt nửa chừng) làm mọi tin của hội thoại đó xếp hàng, và mỗi tin giữ một kết nối của pool (`max` 10), tới lúc cả pool kẹt. Chưa thấy ai mất dữ liệu, nhưng đây là điều kiện sập dây chuyền.
- **Bằng chứng:**
  ```
  $ git grep -nE "statement_timeout|idle_in_transaction|lock_timeout" a443721 -- . ':!*.md' | wc -l
  0
  ```
  `pool.ts:11-16` chỉ có `connectionString`, `max`, `connectionTimeoutMillis`, `application_name`. `bootstrap-roles.sql` đặt thuộc tính vai trò và cấu hình log, không có mục `ALTER ROLE ... SET` nào về thời gian.
- **Đề xuất:** đặt ở mức vai trò (`ALTER ROLE app_role SET statement_timeout = ...`, `idle_in_transaction_session_timeout = ...`) hoặc qua `options` của pool, kèm test đọc `current_setting`. Con số do anh/vận hành chọn; em không tự đoán. Ghi một N-số kể cả khi hoãn.
- **Mức độ:** MEDIUM

### [INFO] A-03 — `SENTRY_DSN` có trong `.env.example` nhưng không mã nào đọc
- **File:** `.env.example:21`.
- **Nhóm:** A.
- **Mô tả:** Biến có mặt từ khung ban đầu, chưa có tích hợp Sentry nào. Không hại gì (giá trị rỗng), chỉ dễ làm người vận hành tưởng lỗi đã được gửi đi đâu đó.
- **Bằng chứng:** `grep -rn SENTRY apps packages` (bỏ `node_modules`) không trả dòng nào; chỉ `.env.example:21`.
- **Đề xuất:** giữ, thêm chú thích "chưa dùng" ở lượt sửa `.env.example` kế tiếp (không đổi trong đợt rà soát này).
- **Mức độ:** INFO

### [INFO] A-04 — Tiêu đề commit trên `main` không theo Conventional Commits hoặc quá dài
- **File:** lịch sử git (`git log a443721`).
- **Nhóm:** A (quy trình).
- **Mô tả:** Trong 86 commit tới `a443721`: 6 tiêu đề không đúng dạng `type(scope): ...`, 64 tiêu đề dài hơn 72 ký tự. Nguyên nhân là **GitHub squash lấy tiêu đề từ PR** (tên nhánh hoặc tiêu đề PR bị cắt), không phải từ commit gốc trong nhánh. Không viết lại lịch sử.
- **Bằng chứng:**
  ```
  aa4384e feat ation and a column-level grant (M1.3 PR1a) (#71)   # bị cắt giữa chừng
  78931f7 Docs/pr m13 0 zalo specs (#70)
  0b322dd Feat/pr m12 outbox 4a worker skeleton (#53)
  9e056e0 Docs/s2 m1 2 specs (#49)
  91f77b1 Feat/pr6c2b auth config (#22)
  6e05c66 Remove pnpm cache from CI configuration
  ```
- **Đề xuất:** đặt tiêu đề PR ≤ 72 ký tự, đúng `type(scope): ...`, và kiểm cài đặt squash của kho: tiêu đề squash phải lấy từ tiêu đề PR, không từ tên nhánh. Phần "(M1.3 PRx)" ở cuối tiêu đề em đặt là nguyên nhân chính của 64 tiêu đề quá 72 ký tự; chuyển mã PR xuống phần thân.
- **Mức độ:** INFO

### [INFO] A-05 — Hai nơi dùng chung không gian khóa tư vấn (advisory lock) của PostgreSQL
- **File:** `packages/db/scripts/migrate.mjs:16`, `packages/db/src/message-store.ts:58`.
- **Nhóm:** A / F.
- **Mô tả:** Runner migration dùng `pg_advisory_lock(7265001)`; kho tin nhắn dùng `pg_advisory_xact_lock(hashtext(conversation_id))`. Cả hai là khóa một đối số kiểu `bigint`, tức cùng một không gian. Khả năng một hội thoại có `hashtext = 7265001` là ~1/2^32 và hệ quả chỉ là tin của hội thoại đó chờ đến hết lượt migration. Không cần xử lý; ghi lại để ai thêm khóa tư vấn thứ ba biết cần một "sổ khóa".
- **Bằng chứng:** `git grep -nE "pg_advisory|hashtext" a443721 -- packages apps` (2 chỗ ở mã chạy thật, ngoài test).
- **Đề xuất:** khi có khóa tư vấn thứ ba, chuyển sang dạng hai đối số `(namespace int, key int)` và ghi namespace trong một file.
- **Mức độ:** INFO

### [INFO] A-06 — Các module của `apps/api` import chéo nhau mà chưa có quy tắc viết tay
- **File:** `apps/api/src/modules/auth/auth.service.ts:4`, `request-context/tenant-context.middleware.ts:7`, `request-context/me.controller.ts:5-6`, `health/health.service.ts:3-4`.
- **Nhóm:** A.
- **Mô tả:** Có 12 import tương đối giữa thư mục module (ngoài test) (ví dụ `auth` → `database`, `request-context` → `auth`, `health` → cả hai). Hướng phụ thuộc hiện không có vòng, nhưng `apps/api/CLAUDE.md` không nói module nào được phụ thuộc module nào, và ESLint không chặn. Khi thêm `conversations` ↔ `request-context` sẽ dễ sinh vòng.
- **Bằng chứng:** `grep -rn "from '\.\./\(auth\|conversations\|database\|request-context\)" apps/api/src/modules` → 12 dòng ở mã chạy thật (có thêm `two-factor.gate.ts:7-8`); `apps/api/CLAUDE.md` không có mục về hướng phụ thuộc.
- **Đề xuất:** viết một dòng hướng phụ thuộc vào `apps/api/CLAUDE.md` (ví dụ `database` ← `auth` ← `request-context` ← `conversations`) trước khi M1.4 thêm module.
- **Mức độ:** INFO

### [INFO] A-07 — `randomUUID()` (UUIDv4) có trong mã chạy thật, đúng quy tắc nhưng dễ bị báo nhầm
- **File:** `apps/api/src/modules/request-context/tenant-context.middleware.ts:44`, `apps/api/src/modules/request-context/two-factor.gate.ts:58`.
- **Nhóm:** A / C.
- **Mô tả:** Hai chỗ dùng `randomUUID()` để sinh `traceId` cho một phản hồi lỗi. `traceId` không phải khóa chính và không lưu vào bảng nào, nên quy tắc P0-2 ("mọi PK dùng UUIDv7") **không bị vi phạm**. Ghi lại để lượt grep sau không coi là lỗi.
- **Bằng chứng:** `git grep -nE "gen_random_uuid|uuid_generate_v4|randomUUID|uuidv4" a443721 -- . ':!*.test.ts' ':!*.spec.ts' ':!*.md'` → 2 chỗ mã chạy thật (trên), còn lại là linter và test của linter.
- **Đề xuất:** không đổi. Nếu muốn nhất quán, dùng `uuidv7()` cho `traceId` (sắp xếp được theo thời gian khi tra log).
- **Mức độ:** INFO

---

## Đã kiểm, không có phát hiện

| Mục | Lệnh / cách kiểm | Kết quả |
|---|---|---|
| `dist/`, `node_modules`, `.env*`, khóa không bị theo dõi | `git ls-files \| grep -E "(^\|/)(\.env($\|\.)\|dist/\|node_modules/\|.*\.pem$\|.*\.key$)"` (trừ `.env.example`) | rỗng |
| `.gitignore` đủ | đọc file | có `.env`, `.env.*`, `!.env.example`, `*.pem`, `*.key`, `node_modules/`, `dist/`, `coverage/`, `.turbo/`, `yarn.lock`, `package-lock.json` |
| `.env.example` không có giá trị thật | đọc từng dòng | 25 tên biến, tất cả giá trị rỗng |
| `pnpm-lock.yaml` không có gói lạ | `grep -cE "tarball:\|resolution: \{(repo\|commit)"` ; `grep -c "integrity:"` | 0 nguồn tarball/git ; 365 mục có `integrity` |
| Phiên bản Node cố định | `.npmrc`, `.nvmrc` | `engine-strict=true`, `22.23.3` |
| CI: action ghim SHA, gitleaks, audit | đọc `ci.yml` | action ghim theo SHA; gitleaks 8.30.1 (ghim SHA); `pnpm audit --audit-level=high`; mật khẩu CI sinh ngẫu nhiên và che |
| Không `console.*` trong mã chạy thật | `git grep -nE "console\." a443721 -- apps packages` (bỏ test) | chỉ `packages/db/scripts/migrate.mjs` (CLI) và `lint-migrations.mjs:272` (CLI) |
| Không `sql.raw` / `sql.identifier` | `git grep -nE "sql\.raw\|sql\.identifier" a443721 -- 'packages/*/src' 'apps/*/src'` | rỗng |
| Không TODO/FIXME/`eslint-disable`/`@ts-ignore`/`as any` trong mã chạy thật | `git grep -nE "TODO\|FIXME\|HACK\|XXX\|eslint-disable\|@ts-ignore\|@ts-expect-error\|as any\|: any\b"` | rỗng |
| `process.env` chỉ ở rìa | `git grep -n "process.env" a443721 -- apps packages` (bỏ test) | `main.ts:27-28`, `auth.module.ts:6`, `database.module.ts:9` (và một câu chú thích `auth.config.ts:21`); cấu hình Better Auth nhận bản đã kiểm, không đọc `process.env` |
| Địa chỉ bind mặc định | `main.ts:11` | `127.0.0.1` (không mở ra mạng nếu không đặt `HOST`) |
| ADR-002 (chỉ `packages/db` dùng `pg`/`drizzle-orm`) | quy tắc `no-restricted-imports` trong `packages/config/eslint.config.mjs` | có; CI `pnpm lint` xanh trên `main` |
| `org_id` không đến từ client | `git grep -nE "@(Body\|Query\|Param\|Headers)\(" a443721 -- apps/api/src` (bỏ test) | rỗng; `orgId` chỉ từ `session.activeOrgId` hoặc kiểm bằng `memberships_for_user` (`tenant-context.middleware.ts:74-83`, `switch-active-org.ts:13`) |
| Gán tham số cho tenant | `tenant-context.ts`, `validate.ts` | `set_config` có tham số hóa; `assertUuid` trước khi dùng |
| Lỗi kết nối không lộ mật khẩu | chạy `pg.Client` với URL giả chứa mật khẩu | thông điệp `connect ECONNREFUSED 127.0.0.1:1`, không có mật khẩu |

## Cần kiểm thêm (INFO, chưa chứng minh được)

1. **Pool `auth_role` dùng cùng `max` mặc định 10** (`pool.ts:13`) với pool của `app_role`: chưa có số liệu để nói 10 là đúng hay thừa. Cần số đo tải thật.
2. **`apps/api/scripts/dev.mjs` chạy `node --watch dist/main.js`**: bị A-01 chặn nên chưa kiểm được vòng phát triển cục bộ có hoạt động trên máy khác hay không.

## Đề xuất ghi vào `QUESTIONS.md` (chưa ghi, anh quyết)

| Số đề xuất | Nội dung | Phát hiện |
|---|---|---|
| N108 | `@gani/domain` build ra `dist`, `exports` đổi; thêm bước smoke "khởi động `dist/main.js` + `GET /health`" vào CI; sửa chú thích N61 | A-01 |
| N109 | Đặt `statement_timeout`, `idle_in_transaction_session_timeout`, `lock_timeout` cho `app_role`/`auth_role`, kèm test `current_setting` | A-02 |

## Giới hạn

Rà soát bởi chính tác giả. Checklist cứng + bằng chứng chạy được. Không thay thế review độc lập.

- Máy rà soát không có Docker/PostgreSQL; bộ test tích hợp (`db`, `queue`, `api`) không chạy cục bộ, chỉ dẫn tên test và lần chạy CI đã xanh.
- Kịch bản dựng riêng (catalog PGlite, thử lỗi kết nối) nằm ngoài kho; lệnh đủ để chạy lại có trong từng dòng bằng chứng.
