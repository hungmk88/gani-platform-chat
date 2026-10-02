# infra/ — Hạ tầng (Terraform, Docker, giám sát)

Nguồn chuẩn: Brief P5 (Deployment), P16 (3 role DB), P17, P19 (Observability) · Phụ lục v2.2 §17, v2.3 §22, §24.
**Chưa chọn cloud (Q2)** — file này không được chốt dịch vụ của một nhà cung cấp cụ thể.

## Trạng thái hiện tại (Q2, CEO chốt 03/10/2026)

- Viết Terraform đến mức `terraform validate` và `terraform plan`. **Chưa `apply` staging.**
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

### Triển khai & migration
- **Rolling update + feature flag**, không downtime; tính năng mới mặc định **tắt** ở production (P5, Phụ lục §24).
- Migration **forward-only**; rollback bằng **migration bù**. Thay đổi phá vỡ theo mẫu expand → migrate → contract qua ≥ 2 release.
- Migration nặng (backfill, index lớn): job nền + `CREATE INDEX CONCURRENTLY`; không khóa bảng `messages`.
- Rollback ứng dụng: triển khai lại image trước và/hoặc tắt feature flag. **Không dùng `terraform destroy` để rollback.**

### Role DB (P16)
- `migration_role`: BYPASSRLS, **không phải superuser**; chỉ pipeline migration/backfill dùng, mỗi lần chạy ghi log.
- `app_role`: không owner, không BYPASSRLS. `support_role`: bị lọc như `app_role`, cần access-session.
- Chi tiết: `docs/specs/rls-spec-M01.md`.
- `infra/scripts/bootstrap-platform-operator`: tạo `platform_operator` đầu tiên, chạy **một lần** bằng `migration_role`, **từ chối nếu đã có** `platform_operator`, ghi audit `reason = "initial bootstrap"`.

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
1. Sửa trong `infra/terraform/modules/*`.
2. `terraform validate` + `terraform plan` ở local (không apply).
3. PR → CI chạy plan; reviewer đọc plan.
4. Chỉ CI/CD apply, và chỉ sau khi Q2 được chốt.
