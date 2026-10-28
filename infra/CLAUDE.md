# infra/ — Hạ tầng (Terraform, Docker, giám sát)

Nguồn chuẩn: Brief P5 (Deployment), P16 (3 role DB), P17, P19 (Observability) · Phụ lục v2.2 §17, v2.3 §22, §24.
**Chưa chọn cloud (Q2)** — file này không được chốt dịch vụ của một nhà cung cấp cụ thể.

## Trạng thái hiện tại (Q2, CEO chốt 03/10/2026)

- Terraform hiện là **khung**: 8 module interface + `envs/staging`, `envs/production`. CI chạy `fmt` và `validate` (job `terraform`). **Chưa `plan`/`apply`** tới khi Q2 chọn nhà cung cấp cloud. Thêm cài đặt cho một nhà cung cấp: tạo `modules/<tên>/<nhà cung cấp>/` và đặt biến `platform` trong `envs/<env>/` (mục Terraform dưới).
- Khung hiện chỉ kiểm cú pháp và việc nối biến giữa env và module. Nó **không** chứng minh resource sẽ chạy khi có cài đặt; phép thử thật đầu tiên là `terraform plan` sau Q2.
- Chỉ CI/CD được `apply`; không `apply` từ máy local hay từ AI.
- Backend lưu state, secret manager, KMS, managed PostgreSQL: **chọn sau khi có Q2** (phụ thuộc Q1 pháp lý về nơi lưu dữ liệu).

## Cấu trúc (module theo Brief P5, không gắn tên nhà cung cấp)

```
infra/
├── terraform/
│   ├── modules/
│   │   ├── network/      — VPC/subnet, security group, load balancer
│   │   ├── compute/      — VM/instance group cho api, worker, ai-gateway
│   │   ├── database/     — PostgreSQL 16 managed, PITR, replica, extension vector/pg_trgm/unaccent
│   │   ├── cache/        — Redis 7, bật AOF
│   │   ├── storage/      — bucket, lifecycle, CORS cho upload widget
│   │   ├── dns_tls/      — domain, chứng chỉ
│   │   ├── secrets/      — secret manager, KMS
│   │   └── monitoring/   — alert rule, dashboard, uptime check
│   └── envs/             — staging, production dùng CHUNG module
├── docker/               — Dockerfile (multi-stage), docker-compose cho dev
├── ai-gateway/           — cấu hình AI Gateway (LiteLLM-compatible)
└── scripts/              — migrate, health-check, bootstrap-platform-operator (không có script deploy tay)
```

## Quy tắc

### Môi trường
- `dev` (docker compose trên máy dev) · `staging` (dữ liệu ẩn danh hoặc seed) · `production`.
- Staging giống production: cùng module Terraform, cùng phiên bản PostgreSQL + extension, cùng role DB (không owner, không BYPASSRLS), cùng cờ tính năng mặc định. Chỉ khác dữ liệu.
- Không copy dữ liệu production xuống staging khi chưa chạy pipeline ẩn danh (Phụ lục §19).

### Terraform (`infra/terraform/`)
- `modules/<tên>/` là **interface**: `variables.tf`, `outputs.tf` cố định; `main.tf` gọi đúng một cài đặt con theo `platform` (`count = var.platform == "<x>" ? 1 : 0`, đầu ra gộp bằng `one(...)`, không chọn gì thì `null`). Env chỉ gọi interface, không bao giờ gọi resource.
- `modules/database/` là mẫu: `dummy_a`, `dummy_temp` không tạo gì, chỉ để `tests/platform.tftest.hcl` chứng minh cơ chế chọn; xóa khi có cài đặt thật đầu tiên. 7 module còn lại chỉ nhận `platform = ""` (giá trị khác báo lỗi "chờ Q2").
- **Không tạo thư mục mang tên nhà cung cấp trước Q2.**
- Khi có Q2 (phương án A): thêm cài đặt của cloud đã chọn vào từng module, khai báo provider (ghim version) trong `envs/*/versions.tf`, commit `.terraform.lock.hcl`, cấu hình `backend.tf` (có mẫu trong comment), đặt `platform`.
- Phương án B (staging tạm, `docs/business/staging-options.md`): thêm cài đặt của nơi tạm, chỉ `envs/staging` đặt `platform` = nơi tạm. Chuyển sang A sau: thêm cài đặt chính thức, đổi `platform` của staging, dựng lại từ seed; `envs/` và interface không đổi.
- Phiên bản: CI dùng đúng `.terraform-version` (1.16.6), kiểm SHA256 trong `terraform.sha256` (4 nền tảng, lấy từ SHA256SUMS có chữ ký HashiCorp); `required_version` cho máy dev bản 1.x mới hơn. Nâng bản: khi bản mới đã ổn ≥ 4 tuần và CI chạy với nó ≥ 1 tuần không lỗi.
- Không `.tfstate`, `.tfvars`, `.terraform/` trong Git (`.gitignore`).

### Docker (`infra/docker/`)
- 4 image, build từ gốc repo: `gani-api`, `gani-worker`, `gani-migrate` (`Dockerfile.node`, `--target api|worker|migrate`) và `gani-admin` (`Dockerfile.admin`, Next.js standalone). Nền `node:22.23.3-slim` (glibc, khớp `@node-rs/argon2`), chỉ linux/amd64; argon2 có sẵn bản `linux-arm64-gnu` nên arm64 chỉ cần buildx.
- Chạy bằng `node` (uid 1000), file thuộc root; không pnpm, npm, corepack lúc chạy; chỉ `dist` + `node_modules` production. `HEALTHCHECK`: api `/healthz` (3000), worker `/healthz` (9464), admin `/login` (3001).
- Tag theo SHA commit, **không `latest`**; chưa push registry (chờ Q2), có registry thì tag semver + SHA.
- `gani-migrate` là **job**, không phải service: ENTRYPOINT `node scripts/migrate.mjs`, không mở port, chạy xong thì thoát. **Chạy trong pipeline CI/CD trước khi deploy api/worker, không chạy trong production runtime.** Image api/worker không mang công cụ của `migration_role`.
- `API_ORIGIN` của admin gắn vào lúc build (`--build-arg`, mặc định `http://api:3000` cho docker compose); đổi thì build lại. Production dùng reverse proxy cho `/v1` và `/api/auth`, `API_ORIGIN` chỉ dùng cho rewrite ở dev/staging; production không dùng reverse proxy thì phải build với đúng `API_ORIGIN`. Admin log `admin_api_origin_default` khi chạy production với giá trị mặc định.
- `api` deploy bằng `pnpm deploy --config.auto-install-peers=false --config.dedupe-peer-dependents=false` (chỉ trong Dockerfile): bỏ peer tùy chọn `next`/`react` của better-auth (~480 MB). Vì vậy peer phải là dependency trực tiếp (`socket.io-adapter` trong `apps/api`).
- Admin (Next.js) không bắt SIGTERM: `docker stop` kết thúc bằng exit 143, bình thường.
- CI job `docker` build cả 4 rồi chạy `infra/docker/test-images.sh` với PostgreSQL + Valkey thật. Ngưỡng: bản nén > 100 MB cảnh báo, > 150 MB đỏ; bản giải nén chỉ cảnh báo (> 400 MB; riêng `node:22-slim` đã ~326 MB). Trivy: CRITICAL có bản sửa → đỏ, HIGH chỉ in.

### Triển khai & migration
- **Rolling update + feature flag**, không downtime; tính năng mới mặc định **tắt** ở production (P5, Phụ lục §24).
- Migration **forward-only**; rollback bằng **migration bù**. Thay đổi phá vỡ theo mẫu expand → migrate → contract qua ≥ 2 release.
- Migration nặng (backfill, index lớn): job nền + `CREATE INDEX CONCURRENTLY`; không khóa bảng `messages`.
- Rollback ứng dụng: triển khai lại image trước và/hoặc tắt feature flag. **Không dùng `terraform destroy` để rollback.**

### Role DB (P16)
- `migration_role`: BYPASSRLS, **không phải superuser**; chỉ pipeline migration/backfill dùng, mỗi lần chạy ghi log.
- `app_role`: không owner, không BYPASSRLS. `support_role`: bị lọc như `app_role`, cần access-session.
- Chi tiết: `docs/specs/rls-spec-M01.md`.
- Bootstrap `platform_operator` đầu tiên (N25, N148): `pnpm --filter @gani/api build && pnpm --filter @gani/api bootstrap:operator` (`apps/api/scripts/bootstrap-platform-operator.mjs`, không ở `infra/scripts/` vì cần đúng bộ băm Argon2id của API). Chạy **một lần** từ pipeline bằng `DATABASE_URL_MIGRATION`, cần `APP_ENV`, `BOOTSTRAP_OPERATOR_EMAIL`, `BOOTSTRAP_OPERATOR_PASSWORD` (`BOOTSTRAP_OPERATOR_NAME` tùy chọn); **từ chối nếu đã có** `platform_operator` hoặc email đã dùng. Dấu vết: một dòng JSON trên stdout (id, `reason = "initial bootstrap"`), không in email/mật khẩu; không có bảng audit nào nhận dòng không có công ty.

### Sao lưu & khôi phục (Phụ lục v2.3 §22)
- PITR bật. **RPO ≤ 1 giờ, RTO ≤ 4 giờ.**
- Diễn tập khôi phục mỗi quý, có biên bản. Nếu cloud không có PITR: tự cài công cụ tương đương.
- Không xóa bản sao lưu khi chưa kiểm chứng khôi phục.

### Secrets
- Secret manager của cloud được chọn; app đọc lúc khởi động. Token kênh mã hóa envelope.
- Không `.env` trong Git; `.env.example` chỉ chứa tên biến. Không commit `.tfvars` có secret.

### Cấu hình PostgreSQL chống lộ token vào log (module `database`)
- `ALTER ROLE app_role SET log_min_duration_statement = -1;` và cùng cài đặt cho `auth_role` (token lời mời đi qua `auth_role`).
- `log_parameter_max_length = 0`, `log_parameter_max_length_on_error = 0` (PostgreSQL ≥ 13).
- Bật `pg_stat_statements` để đo hiệu năng.
- Mọi truy vấn mang token phải dùng tham số hóa (prepared statement), không ghép chuỗi.
- Chi tiết và lý do: `docs/specs/rls-spec-M01.md` §3.7. Nếu nhà cung cấp managed không cho đổi các tham số này: báo ngay khi chốt Q2.

### Giám sát
- Metrics, tracing, cảnh báo và ngưỡng: theo **Brief P19** (không lặp lại ở đây; có một nguồn duy nhất).
- Cảnh báo bắt buộc có từ đợt 1: dead-letter webhook, hàng đợi tồn, uptime 30 giây/lần, đĩa/kết nối DB, job tạo partition lỗi, TLS sắp hết hạn.

## Cấm
- `terraform apply` từ local hoặc từ AI (chỉ CI/CD).
- SSH vào production để debug (dùng access-session qua `support_role`, có audit).
- Sửa security group/cấu hình từ console (chỉ Terraform).
- Scale database bằng tay.
- Chốt dịch vụ của một cloud cụ thể (ECS, EKS, RDS…) trước khi Q2 được trả lời.

## Khi sửa infra
1. Sửa trong `infra/terraform/modules/*` (interface hoặc cài đặt), env chỉ đổi giá trị.
2. Trước khi push: `terraform -chdir=infra/terraform fmt -recursive`; có Terraform CLI thì `init -backend=false` + `validate` từng env, `test` trong `modules/database`. CI job `terraform` đỏ nếu format sai hay validate/test lỗi.
3. Sau Q2: PR → CI chạy `plan`; reviewer đọc plan.
4. Chỉ CI/CD apply, và chỉ sau khi Q2 được chốt.
