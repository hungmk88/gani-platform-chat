# ADR-0001 — Monorepo pnpm workspaces + Turborepo, trunk-based

- Trạng thái: Chấp nhận (Brief v0.4 P6 đã chốt) · 03/10/2026
- Nguồn: Brief P6

## Bối cảnh
api, worker, admin, widget dùng chung kiểu dữ liệu, Zod schema và event contract. Nếu sau này thay vendor, bên mới cần tiếp quản một repo duy nhất.

## Quyết định
- Một repo: `apps/{api,worker,admin,widget}`, `packages/{domain,db,ai-core,channels,ui,testing,config}`, kèm `prompts/`, `evals/`, `infra/`, `docs/`.
- Trunk-based: nhánh sống ≤ 2 ngày, PR ≤ 400 dòng, Conventional Commits. CI xanh mới được merge.
- Repo đặt ở GitHub organization `gani-foods`, pháp nhân Gani Foods (Q3). CI dùng GitHub Actions.
- **Phải commit `pnpm-lock.yaml`**, vì CI cài đặt có thể tái lập và SCA đều cần lockfile. File `.gitignore` hiện tại đang chặn lockfile, PR1 sẽ sửa.

## Hệ quả
- Luật kiểm chất lượng dùng ESLint + `tsc --strict` + Vitest, thay cho ruff/mypy/pytest trong quy tắc Python toàn cục.
- `no-explicit-any` để mức error trong `packages/*` và `apps/api/src/modules/*`.
