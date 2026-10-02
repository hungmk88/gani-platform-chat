# ADR-001 — Monorepo pnpm workspaces + Turborepo

| | |
|---|---|
| Trạng thái | Chấp nhận (Brief v0.4 P6 đã chốt) · chờ review PR0 |
| Ngày | 03/10/2026 |
| Nguồn | Brief P4, P6 |

## Bối cảnh
`apps/api`, `apps/worker`, `apps/admin`, `apps/widget` dùng chung kiểu dữ liệu, Zod schema, event contract và mã lỗi. Nếu sau này đổi vendor (Phụ lục §18 — kế hoạch rút lui), bên mới cần tiếp quản một nơi duy nhất.

## Quyết định
- Một repo, pnpm workspaces + Turborepo; cấu trúc thư mục theo Brief P6 (`apps/`, `packages/`, `prompts/`, `evals/`, `infra/`, `docs/`).
- Trunk-based: nhánh sống ≤ 2 ngày, PR ≤ 400 dòng (không tính file sinh tự động), Conventional Commits, CI xanh mới merge. Tính năng dở dang nằm sau feature flag.
- Repo đặt trong GitHub organization `gani-foods`; CI dùng GitHub Actions (Q3).
- CODEOWNERS: PR chạm `packages/db`, `packages/ai-core`, policy RLS, auth cần Tech Lead duyệt thêm.
- `pnpm-lock.yaml` **phải được commit** (CI cài đặt tái lập được, quét SCA cần lockfile).

## Lý do
- Một ngôn ngữ (TypeScript); kiểu và Zod schema dùng chung, đổi contract thì CI báo lỗi ở mọi nơi dùng.
- Một pipeline CI/CD, một bộ lint, một bộ cấu hình.
- Bàn giao cho vendor thay thế dễ.

## Đánh đổi
| Đa repo | Monorepo (chọn) |
|---|---|
| Quyền truy cập tách theo repo | Phải dùng CODEOWNERS, không tách được quyền đọc |
| CI mỗi repo nhỏ, nhanh | CI toàn repo chậm dần → bắt buộc dùng cache Turbo, chỉ chạy gói bị ảnh hưởng |
| Phiên bản chung phải publish package | Không cần publish, nhưng mọi gói cùng một nhịp nâng cấp |

## Hệ quả
- Công cụ chất lượng: ESLint + `tsc --strict` + Vitest (thay cho ruff/mypy/pytest trong quy tắc Python toàn cục; xem `QUESTIONS.md`).
- `no-explicit-any` ở mức `error` trong `packages/*` và `apps/api/src/modules/*`.
- Sửa `.gitignore`: bỏ dòng chặn `pnpm-lock.yaml`.
