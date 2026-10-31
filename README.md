# Gani Platform Chat

Nền tảng Chat & AI Chatbot đa tenant cho 5 công ty (Brief Backend & Core v1.0, 12/10/2026).
**Trạng thái (19/10/2026):** M1.1 (nền, tenant, RLS, xác thực) và M1.2 (hội thoại, FSM, outbox, worker) đã xong, trừ
Terraform staging, webhook và Socket.IO; module hội thoại có mã nhưng chưa gắn vào API. M1.3 (inbound) xong phần cơ sở dữ liệu
và kho. Chưa có AI, giao diện (`admin`, `widget`) và kênh Zalo chạy thật. Tiến độ và review mới nhất:
`docs/reviews/I-progress-review-2026-10-19.md`; audit toàn bộ: `docs/reviews/H-full-codebase-audit.md`; rà soát M1.1–M1.3:
`docs/reviews/00-summary.md`.

## Yêu cầu

- **Node.js** `^22.13.0` hoặc `^24` (CI dùng `22.23.3`, xem `.nvmrc`).
- **pnpm 9.15.0** qua corepack:

  ```bash
  corepack enable          # Windows: mở PowerShell bằng quyền Administrator nếu Node nằm ở C:\Program Files
  corepack prepare pnpm@9.15.0 --activate
  pnpm --version           # phải ra 9.15.0
  ```

- **Docker Desktop** cho PostgreSQL, Valkey, Mailpit. API khung chạy được không cần Docker.

## Chạy môi trường dev

```bash
pnpm install
cp .env.example .env     # PowerShell: Copy-Item .env.example .env
# Sửa POSTGRES_PASSWORD trong .env (file này đã nằm trong .gitignore, không commit)
pnpm dev                 # bật docker compose (hạ tầng) rồi chạy API
```

Kiểm tra API đã chạy:

```bash
curl http://localhost:3000/healthz   # {"status":"ok"}
```

- Chỉ chạy API (không Docker): `pnpm dev:api`.
- Chỉ bật hạ tầng: `pnpm dev:infra`. Tắt: `docker compose --env-file .env -f infra/docker/docker-compose.yml down`.
- Cổng (đều chỉ mở trên `127.0.0.1`): PostgreSQL `5432`, Valkey `6379`, Mailpit SMTP `1025` và giao diện `http://localhost:8025`.
- API đọc `PORT` (mặc định `3000`) và `HOST` (mặc định `127.0.0.1`) từ `.env`.

## Kiểm tra trước khi tạo PR

```bash
pnpm build      # trước pnpm lint: ESLint đọc kiểu của @gani/db từ dist/
pnpm lint
pnpm typecheck
pnpm test
pnpm format:check
```

CI (`.github/workflows/ci.yml`) chạy đúng các lệnh trên, thêm `pnpm audit --audit-level=high` và quét secret
bằng `gitleaks` trên toàn bộ lịch sử, và kiểm migration (`pnpm --filter @gani/db lint:migrations`: RLS, UUIDv4,
CASCADE, `SECURITY DEFINER`, khối `-- rollback:`, tên file). Quy tắc PR: ≤ 400 dòng (mục tiêu; vượt thì báo trước, xem `CLAUDE.md`), Conventional Commits, không commit `.env` hay file do công cụ
tự sinh ở thư mục gốc.

## Cơ sở dữ liệu (dev)

Cần Docker. Trong `.env` đặt `APP_ROLE_PASSWORD`, `AUTH_ROLE_PASSWORD`, `MIGRATION_ROLE_PASSWORD`, và ba URL
`DATABASE_URL_APP|AUTH|MIGRATION` dạng `postgres://<role>:<mật khẩu>@127.0.0.1:5432/gani_platform`.

```bash
pnpm dev:infra                          # lần đầu (volume rỗng) tự tạo 4 role: infra/db/bootstrap-roles.sql
pnpm --filter @gani/db migrate          # áp migration bằng migration_role
pnpm --filter @gani/db test:integration # test cần DB thật; thiếu DB thì báo lỗi, không bỏ qua (trước đó `scripts/check-db.sh` bật cụm và kiểm DB đã migrate)
```

Script tạo role chỉ chạy khi thư mục dữ liệu còn trống. Đổi mật khẩu hoặc làm lại từ đầu:
`docker compose --env-file .env -f infra/docker/docker-compose.yml down -v` (xóa dữ liệu dev).
Máy không có Docker thì test DB chỉ chạy trên CI (job `db`).

## Hook pre-commit

`pnpm install` tự chạy `scripts/setup-hooks.mjs` để đặt `core.hooksPath` thành `.githooks`. Hook
`.githooks/pre-commit` quét secret ở các file staged bằng `gitleaks` nếu máy có cài; không có thì chỉ in cảnh báo
và vẫn cho commit (CI mới là chốt chặn thật).

Hook `.githooks/pre-commit` yêu cầu Git for Windows (`sh.exe` trong PATH). Nếu commit từ PowerShell mà hook không
chạy, kiểm tra: `where.exe sh`. Nếu không có thì dùng Git Bash để commit.

## Cấu trúc

```
apps/
  api/        NestJS (ESM): HTTP API; module auth, hội thoại, bối cảnh tenant; /healthz, /readyz
  worker/     Node thuần: outbox relay (BullMQ), bảo trì partition; chưa có bộ xử lý inbound
  admin/ widget/        mới là khung rỗng
packages/
  config/     tsconfig, ESLint, Prettier, cấu hình Vitest dùng chung
  domain/     UUIDv7 (RFC 9562), FSM hội thoại thuần (`decide`, bảng chuyển trạng thái)
  db/         schema Drizzle, migration (RLS, partition), kho (outbox, inbound, tin nhắn), lint migration
  ai-core/ channels/ ui/ testing/    mới là khung rỗng
infra/docker/ docker-compose cho dev (PostgreSQL 16 + pgvector, Valkey, Mailpit)
docs/         Brief v1.0 (v0.4 giữ làm lịch sử), phụ lục kỹ thuật, ADR, đặc tả (`specs/`), rà soát mã (`reviews/`)
prompts/ evals/                         quy ước (chưa có nội dung)
```

## Đọc trước khi làm việc

- `CLAUDE.md`: quy tắc cốt lõi (và `CLAUDE.md` trong từng thư mục con).
- `docs/brief-backend-core-v1.0.md`: Brief hiện hành; hồ sơ gốc và phụ lục thắng khi mâu thuẫn.
- `docs/implementation-brief.md`: Brief v0.4, **đã thay thế**, giữ làm lịch sử (hồ sơ cho luật sư); không dùng làm nguồn mới.
- `docs/reviews/00-summary.md`: tổng hợp rà soát mã M1.1–M1.3 (phát hiện, trạng thái, N-số).
- `QUESTIONS.md`: chỗ chưa chốt. Gặp chỗ chưa rõ thì ghi vào đây, không tự đoán.
