# QUESTIONS.md — Những chỗ cần chốt

Gặp chỗ chưa rõ trong Brief v0.4 / Phụ lục → ghi vào đây, **không tự đoán**. Mâu thuẫn giữa các tài liệu → hồ sơ gốc thắng.

## Đã chốt (03/10/2026)

| # | Câu hỏi | Quyết định | Ai chốt |
|---|---|---|---|
| Q2 | Cloud / vùng | Terraform chỉ chạy đến `validate`/`plan`, **chưa apply staging**, chờ Q1 pháp lý. Integration test chạy local nếu có Docker, không thì chạy trên CI | CEO |
| Q3 | Pháp nhân, repo, CI | Gani Foods đứng tên · GitHub org `gani-foods` · GitHub Actions | CEO |
| Q4 | ORM | Drizzle (ADR-0002) | Cố vấn |
| Q5 | Auth | Better Auth, chỉ dùng cho login/phiên/2FA, không dùng plugin `organization`, Argon2id, UUIDv7 (ADR-0003) | Cố vấn |
| S1-1 | `conversations` ở S1 | Bảng khung: `id, org_id, workspace_id, state, version, timestamps`; S2 mở rộng | CEO |
| S1-2 | M02 một phần | `channel_accounts` + `channel_policies`. `inbound_events` + `outbox_events` để S2 | CEO |
| S1-3 | P3, P6 | P3 (PITR) làm trong Terraform. **P6 quét virus dời sang S2** vì module `files` chưa có ở S1 | CEO |
| S1-5 | Đọc bảng auth khi chưa có tenant | Thêm role `auth_role`. **Cố vấn chưa duyệt** (xem N2) | CEO → cố vấn |
| S1-6 | Email mời | Gửi qua adapter; dev dùng Mailpit; nhà cung cấp thật chốt ở S3 | CEO |
| S1-7 | API Team (A4) | Làm cả `/v1/teams` ở S1. **Đề xuất bổ sung vào bảng endpoint P9 của Brief** | CEO |
| S1-8 | Partition | S1 dùng `PartitionMaintenanceJob` tự viết; chuyển sang pg_partman khi biết cloud | CEO |
| S1-9 | Chính sách | Lời mời hết hạn 7 ngày · mật khẩu ≥ 12 ký tự, có chữ + số · sai 5 lần khóa 30 phút | CEO |

## Đang mở — chặn PR1

| # | Câu hỏi | Đề xuất mặc định | Cần ai |
|---|---|---|---|
| **N0** | `docs/implementation-brief.md` trong repo **không phải Brief v0.4 thật**: 269 dòng (bản thật 1040), ghi Prisma/JWT/Jest/"S1 90 ngày". Trong khi `CLAUDE.md` bảo đọc file này đầu tiên. Bản thật cùng 2 phụ lục đang nằm ở thư mục gốc repo | Chuyển 3 file gốc vào `docs/source/`, xóa bản tóm tắt sai, sửa đường dẫn trong `CLAUDE.md` + `README.md` | CEO |
| **N0b** | `evals/CLAUDE.md`, `infra/CLAUDE.md`, `prompts/CLAUDE.md` trái với Brief: chốt sẵn AWS/ECS/K8s trong khi Q2 chưa chọn cloud; ghi RTO < 1h + backup đêm (Brief: RTO ≤ 4h, PITR RPO ≤ 1h); `migration_role` = superuser (Brief: chỉ BYPASSRLS); rollback bằng `terraform destroy`; dùng Jest (đã chốt Vitest); đặt bộ 200 câu vào repo (Brief P6: dataset **không** nằm trong repo vendor); che PII thành `[REDACTED_PHONE]` (Brief P8: `[PHONE_1]`); ngưỡng regression 90% (Brief S12: ≥ 95%); tool theo "OpenAI format", judge cứng Claude Haiku (model phải nằm trong config); đặt tên prompt khác `prompts/<template>/<task>@<semver>` | Viết lại 3 file bám Brief, hoặc thu gọn chỉ còn trỏ tới mục P tương ứng | CEO |
| **N1** | P8 ghi `users` là "— (truy cập qua membership)". Đặc tả hiểu là: RLS theo membership, `app_role` chỉ đọc `id, display_name, locale` | Như đặc tả §4 | Cố vấn |
| **N2** | `auth_role` không chỉ đọc mà còn phải **ghi** `auth_sessions`, `auth_verifications`, `auth_two_factors` và cột khóa đăng nhập của `users` | Cho phép ghi đúng các bảng/cột đó | Cố vấn |
| **N3** | Một user thuộc nhiều org: org nào đang hoạt động? | User chọn sau khi đăng nhập; server kiểm membership rồi lưu `active_org_id` vào phiên. Client chỉ gửi ý định, không gửi quyền | Cố vấn |
| **N4** | Đổi vai trò → "xoay phiên" của người bị đổi | Thu hồi mọi phiên của người đó, buộc đăng nhập lại | Cố vấn |
| **N5** | Cố vấn duyệt `docs/specs/rls-and-db-roles.md` + ADR-0004 | — | Cố vấn |

## Đang mở — không chặn PR1

| # | Câu hỏi | Đề xuất mặc định | Cần trước |
|---|---|---|---|
| N6 | `.gitignore` đang chặn `pnpm-lock.yaml` → CI không tái lập được, SCA không chạy được | Bỏ dòng đó ở PR1 | PR1 |
| N7 | Bảng `invitations` không có trong P8 | Thêm vào M01, RLS O, chỉ lưu hash token | PR4a |
| N8 | Lời mời gửi tới email đã có tài khoản (đang là thành viên org khác) | Không tạo user mới, chỉ thêm membership sau khi người đó chấp nhận | PR7 |
| N9 | Có cần ghi lại toàn bộ lịch sử đăng nhập (thành công/thất bại) không? Hay chỉ audit thao tác quản trị (A9)? | Ghi vào `audit_logs` đăng nhập thất bại và việc bị khóa; không ghi IP thô | PR6 |
| N10 | Repo chưa `git init`; nhánh mặc định | `main`, có branch protection: CI xanh + 1 reviewer, Tech Lead với `packages/db` | Trước khi push |
