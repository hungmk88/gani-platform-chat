# QUESTIONS.md — Những chỗ cần chốt

Gặp chỗ chưa rõ trong Brief v0.4 / Phụ lục → ghi vào đây, **không tự đoán**. Mâu thuẫn giữa các tài liệu → hồ sơ gốc thắng.

## Đã chốt (03/10/2026)

| # | Câu hỏi | Quyết định | Ai chốt |
|---|---|---|---|
| Q2 | Cloud / vùng | Terraform chỉ chạy đến `validate`/`plan`, **chưa apply staging**, chờ Q1 pháp lý. Integration test chạy local nếu có Docker, không thì chạy trên CI | CEO |
| Q3 | Pháp nhân, repo, CI | Gani Foods đứng tên · GitHub org `gani-foods` · GitHub Actions | CEO |
| Q4 | ORM | Drizzle (ADR-002) | Cố vấn |
| Q5 | Auth | Better Auth, chỉ login/phiên/2FA, không dùng plugin `organization`, Argon2id, UUIDv7 (ADR-003) | Cố vấn |
| S1-1 | `conversations` ở S1 | Bảng khung `id, org_id, workspace_id, state, version, timestamps`; S2 mở rộng | CEO |
| S1-2 | M02 một phần | `channel_accounts` + `channel_policies`; `inbound_events` + `outbox_events` để S2 | CEO |
| S1-3 | P3, P6 | P3 (PITR) làm trong Terraform; **P6 quét virus dời sang S2** vì chưa có module `files` | CEO |
| S1-4 | Better Auth | Chỉ login/phiên/2FA, không plugin `organization`, Argon2id, UUIDv7, tạo lại phiên sau đăng nhập / đổi vai trò / bật-tắt 2FA | CEO |
| S1-5 | Đọc bảng auth khi chưa có tenant | Role `auth_role`, GRANT theo cột, không RLS. **Lệch Brief có chủ đích — cần cố vấn duyệt** (xem N1–N2) | CEO → cố vấn |
| S1-6 | Email mời | Qua adapter; dev dùng Mailpit; nhà cung cấp thật chốt ở S3 | CEO |
| S1-7 | API Team (A4) | Làm cả `/v1/teams` ở S1; **đề xuất bổ sung vào bảng endpoint P9** | CEO |
| S1-8 | Partition | S1 dùng `PartitionMaintenanceJob` tự viết; chuyển pg_partman khi biết cloud | CEO |
| S1-9 | Chính sách | Lời mời hết hạn 7 ngày · mật khẩu ≥ 12 ký tự, có chữ + số · sai 5 lần khóa 30 phút | CEO |
| S1-10 | `users` | Bảng toàn cục, không `org_id`, không RLS (theo Brief); `org_members` nối user ↔ org | CEO |
| S1-11 | Lời mời | Chưa tạo bảng `invitations` ở S1; dùng cột trên `org_members` với `status='pending'`. **Cần cố vấn duyệt** (xem N6) | CEO → cố vấn |
| S1-12 | `.gitignore` | Bỏ dòng chặn `pnpm-lock.yaml` | CEO |

## Đang mở — chặn PR1 (cần cố vấn)

| # | Câu hỏi | Đề xuất mặc định | Tài liệu |
|---|---|---|---|
| **N1** | Brief P16 chỉ có 3 role DB. Thêm `auth_role` có được không? | Có, theo `rls-spec-M01.md` §3 | ADR-003/004, spec §3 |
| **N2** | `auth_role` phải **ghi** `sessions`, `verifications`, `two_factors` và cột khóa đăng nhập của `users`, không chỉ đọc hẹp | Cho phép đúng các bảng/cột ở spec §3.2 | spec §3.2 |
| **N3** | `app_role` không đọc trực tiếp `users` (bảng toàn cục không RLS: cấp `SELECT` cột sẽ lộ người dùng tenant khác). Hiển thị tên qua view `app.org_users` | Như spec §3.3 | spec §3.3 |
| **N4** | Xoay phiên khi đổi vai trò: **thu hồi mọi phiên của user bị đổi** hay chỉ phiên hiện tại? | Thu hồi mọi phiên của người bị đổi, buộc đăng nhập lại | ADR-003 |
| **N5** | Người dùng thuộc nhiều công ty: công ty nào đang hoạt động trong phiên? | Chọn sau đăng nhập; server kiểm membership (qua `app.memberships_for_user`) rồi lưu `active_org_id` trong phiên; client chỉ gửi ý định | spec §3.5 |
| **N6** | `invitations`: dùng cột trên `org_members` (đã chốt tạm) hay bảng riêng? Hai vấn đề của hướng hiện tại: (a) `user_id` phải nullable; (b) tra token mời khi chưa có tenant cần hàm `SECURITY DEFINER` | Giữ cột trên `org_members` ở S1; xem lại khi viết PR7 | spec §4.3 |
| **N7** | Cố vấn duyệt toàn bộ `docs/specs/rls-spec-M01.md` + ADR-004 | — | — |

## Đang mở — không chặn PR1

| # | Câu hỏi | Đề xuất mặc định | Cần trước |
|---|---|---|---|
| N8 | Tra `api_keys` khi request đến mà chưa có tenant context (tra theo `key_prefix`) | Hàm `SECURITY DEFINER` hẹp tương tự lời mời | Đợt 3 (bảng có ở S1) |
| N9 | Ai được tạo `organizations` (A1)? RLS không trả lời được vì tạo org xảy ra trước khi có membership | Chỉ `platform_operator` (A10 tự phục vụ để sau đợt 3) | PR7 |
| N10 | `workspaces` chỉ RLS theo O (người dùng cần thấy danh sách để chọn), không O+W. Đúng ý Brief P8? | Giữ O; lọc theo workspace được cấp ở tầng service | PR4 |
| N11 | `workspace_members.workspace_role`: có vai trò riêng cho từng workspace khác vai trò org không? Brief nói "7 vai trò" nhưng không nói gắn ở cấp nào | Chỉ vai trò ở `org_members`; workspace chỉ quyết định "có vào được hay không" | PR7 |
| N12 | Hiển thị `email` trong màn quản lý thành viên: cần view/hàm riêng vì `app.org_users` không có `email` | Thêm cột `email` vào view chỉ khi vai trò Owner/Admin (kiểm ở service) | PR7 |
| N13 | Có ghi lịch sử đăng nhập (thành công/thất bại) hay chỉ audit thao tác quản trị (A9)? | Ghi đăng nhập thất bại và việc bị khóa vào `audit_logs`, không ghi IP thô | PR6 |
| N14 | `teams.slug` unique theo `(org_id, workspace_id, slug)` hay `(org_id, slug)` (P8 ghi chung)? | `(org_id, workspace_id, slug)` | PR4 |
| N15 | Quy tắc Python toàn cục (ruff/mypy/pytest) vs dự án TypeScript | ESLint + `tsc --strict` + Vitest (ADR-001) | PR1 |
| N16 | Docker/WSL2 trên máy dev chưa chắc chạy được → integration test (testcontainers) chỉ chạy được trên CI | Chấp nhận cho S1–S2 | PR3 |
| N17 | ~~3 file `evals/`, `infra/`, `prompts/` `CLAUDE.md` trái Brief~~ **Đã sửa trước commit** (AWS/ECS/K8s, RTO/RPO, `migration_role` superuser, `terraform destroy`, Jest, dataset trong repo, `[REDACTED_*]`, ngưỡng 90%, tên model/Bull/SQS, cache prompt tự dựng, đặt tên prompt). Chờ CEO xem lại bản sửa | — | — |
| N18 | ~~ai-core trái Brief~~ **Đã chốt:** Brief P8 và P11 không thống nhất (P11 có họ tên, ngày sinh; P8 không có). Đã sửa P8 theo P11, thêm `customers.type`; cập nhật `ai-core` và `evals` CLAUDE.md | — | — |
| N19 | ~~Email nhận lời mời~~ **Đã chốt:** email của phiên đăng nhập phải khớp `invited_email`; không khớp → cùng thông báo "Link không hợp lệ hoặc đã hết hạn" (spec §3.7) | — | — |
@@| N20 |
@@| N21 |
@@| N22 |
| N23 | ~~Ai đặt `customers.type`~~ **Đã chốt:** mặc định theo mẫu workspace: `b2b_sales` → `business`, `b2c_order` → `individual`, `service` → người dùng chọn; agent sửa được sau; AI đề xuất dựa trên tín hiệu | — | — |
| N24 | ~~Che tên người liên hệ~~ **Đã chốt:** che tên người, giữ tên doanh nghiệp; văn bản tự do: câu chứa tên doanh nghiệp đã biết thì giữ, phần còn lại nghi tên người thì che; chấp nhận sót ±5%; nếu độ tin cậy có PII > 90% → che cả câu. Còn lại: ghi vào spec M03 khi viết | Viết vào spec M03 | M03 |
| N25 | ~~Tạo `platform_operator` đầu tiên~~ **Đã chốt:** script `infra/scripts/bootstrap-platform-operator`, chạy `migration_role`, một lần, từ chối nếu đã có `platform_operator`, ghi audit `reason = "initial bootstrap"` | — | — |
| N26 | ~~Khóa Redis `auth:`~~ **Đã chốt:** chấp nhận ngoại lệ; bắt buộc TTL ≤ 5 phút, không PII, định danh là hash; đã cập nhật Brief P16 | — | — |
| N27 | ~~Better Auth `DELETE` phiên~~ **Đã chốt:** ghi đè, dùng `revoked_at`; `SessionCleanupJob` (`migration_role`) xóa cứng phiên revoked/hết hạn > 30 ngày; đã ghi vào ADR-003 | — | — |
| N28 | ~~`email_verified_at` khi nhận lời mời~~ **Đã chốt:** `NULL` khi `accept_invite` tạo user (`status = 'pending_password'`); đặt `now()` + `status = 'active'` cùng transaction khi đặt mật khẩu thành công (spec §3.7, ADR-003) | — | — |
| N29 | ~~Thông báo khi user đã có tài khoản nhưng chưa đăng nhập~~ **Đã chốt:** không phân biệt; mọi lỗi trong `accept_invite` trả cùng status + message, kể cả trường hợp này (spec §3.7) | — | — |
| N30 | ~~User bỏ dở sau accept~~ **Đã chốt:** `users.status = 'pending_password'`; sau accept gửi magic link đặt mật khẩu (token riêng, TTL 24 giờ) + JWT 15 phút; `PendingUserCleanupJob` (`migration_role`) xóa user quá 24 giờ và đưa `org_members` về lời mời hết hạn; **không** thêm `SECURITY DEFINER` (spec §3.7, ADR-004) | — | — |
| N31 | ~~Idempotency không lưu JWT~~ **Đã chốt:** kho chỉ lưu `user_id`, `org_member_id`, `accepted_at`; replay → "Đã chấp nhận, kiểm tra email để đặt mật khẩu" — khác thông báo lỗi chung; chỉ người có cả token lẫn Idempotency-Key thấy; mức lộ chấp nhận (token 256-bit). **Cố vấn xác nhận** (spec §3.7, Brief P9) | Cố vấn xác nhận | Trước PR7 |
| N32 | ~~`pending_password` được mời vào org 2~~ **Đã chốt:** được phép, không reject; thu hồi magic link cũ, phát magic link mới, đặt lại `pending_password_since` (cột mới trên `users`); cleanup trả mọi `org_members` của user về lời mời hết hạn (spec §3.7) | — | — |
| N33 | ~~Endpoint resend-invite~~ **Đã chốt:** `POST /v1/members/{id}/resend-invite` (Brief P9); chỉ khi `status = 'pending'`; ghi đè `invite_token_hash` (`org_members` không có `revoked_at`, nên token cũ vô hiệu bằng cách ghi đè; đã ghi vào ADR-004); 5/phút/member, 20/giờ/org | — | — |
| N35 | Trạng thái cố vấn: PR0 đã push khi chưa có cố vấn thật (spec RLS, ADR-004, N1–N7, N31 chưa ai duyệt). AI làm cố vấn tạm. PR3 trở đi (chạm RLS) bắt buộc chờ cố vấn thật | Tìm cố vấn thật trước PR3 | Trước PR3 |
| N36 | Branch protection giai đoạn 1 người (repo `hungmk88/gani-platform-chat`): Required approvals = 0; giữ Require PR, conversation resolution, chặn force push, hạn chế xóa nhánh; CODEOWNERS đã tạo nhưng để comment, chưa kích hoạt. Bật lại khi có cố vấn + dev thứ 2 (lưu ý: quy tắc chưa được GitHub thi hành, xem N38) | Bật lại approvals + CODEOWNERS khi có người thứ 2 | Khi có người thứ 2 |
| N37 | ~~Xác minh giấy phép `busboy@1.6.0` và `streamsearch@1.1.0`~~ **Đã xác minh (03/10/2026): cả hai MIT** (metadata npm khai báo kiểu cũ `licenses: MIT`, trùng nội dung `LICENSE` trên GitHub `mscdex/*`). Cả hai chỉ có 1 maintainer cá nhân (mscdex), nằm sâu trong `@nestjs/platform-express` | — | — |
| N38 | Branch protection chưa được thi hành: GitHub Free không enforce branch protection/ruleset trên repo Private. **Đã chốt (tạm):** để nguyên, không enforce. Bù bằng: Dev không tự commit/push, anh duyệt từng PR, AI review. Nâng cấp GitHub Team khi có ≥ 2 collaborator; rule `main` đã tạo sẵn, sẽ tự thi hành sau khi nâng cấp. (Anh gọi mục này là "N37"; N37 đã dùng cho việc xác minh giấy phép `busboy`/`streamsearch`) | Nâng cấp GitHub Team khi có người thứ 2 | Khi có ≥ 2 collaborator |
| N39 | PR1a vượt 400 dòng: 466 dòng (không tính lockfile). **Đã chốt:** chấp nhận vì là scaffold đầu tiên, không có logic nghiệp vụ, tách sẽ làm CI vỡ. Từ PR1b trở đi giữ ≤ 400 dòng. (Anh gọi mục này là "N38"; N38 đã dùng cho branch protection) | — | PR1b |
