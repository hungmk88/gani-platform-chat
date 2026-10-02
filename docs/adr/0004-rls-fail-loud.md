# ADR-0004 — Cách ly tenant 3 lớp, RLS báo lỗi khi thiếu ngữ cảnh

- Trạng thái: Đề xuất — chờ cố vấn duyệt cùng `docs/specs/rls-and-db-roles.md` · 03/10/2026
- Nguồn: Brief P16; Phụ lục v2.1 §1–2, v2.3 §20

## Quyết định
1. Ba lớp: `TenantContextMiddleware` (AsyncLocalStorage) → `TenantTx` → RLS. RLS chỉ là lưới cuối cùng.
2. `orgId` và `workspaceIds` chỉ lấy từ session, API key, widget token, channel account hoặc payload job. **Không bao giờ** lấy từ body/query.
3. Policy đọc ngữ cảnh qua `app.current_org()` / `app.current_workspaces()`. Thiếu ngữ cảnh → lỗi `TN001`, không trả 0 dòng.
4. Bốn role DB: `app_role`, `migration_role`, `support_role` (theo Brief) và **`auth_role`** (bổ sung theo Q5/QUESTIONS #5).
5. FK kép `(org_id, id)`, `ON DELETE RESTRICT`, không cascade từ `organizations`.

## Hệ quả
- Quên `TenantTx` sẽ lộ ngay ở dev và CI dưới dạng lỗi 500 + Sentry, không âm thầm ra dữ liệu rỗng.
- Thêm `auth_role` khác Brief P16 (Brief ghi 3 role). Cần cố vấn duyệt.
