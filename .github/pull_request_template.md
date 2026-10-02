## 📋 Checklist PR

> Đọc `CLAUDE.md` trước khi gửi PR. Tất cả điểm dưới PHẢI pass.

### Code Quality
- [ ] Đã vào Plan Mode trước khi code, phương án đã được duyệt
- [ ] PR ≤ 400 dòng (không tính file sinh tự động)
- [ ] `pnpm test && pnpm lint && pnpm typecheck` **pass**
- [ ] Không có `any` trong `src/modules/*` (nếu là API)
- [ ] Không log PII, chỉ log `messageId`, `traceId`, `orgId`

### Database (nếu đổi schema)
- [ ] `tenant-isolation.spec` **pass** (dùng `app_role` không set tenant → báo lỗi)
- [ ] `workspace-isolation.spec` **pass**
- [ ] Migration: `ENABLE ROW LEVEL SECURITY + FORCE`
- [ ] Không `ON DELETE CASCADE` từ `organizations`
- [ ] Lint migration pass (CI chặn)
- [ ] Có rollback path (expand → migrate → contract)

### AI / Pricing (nếu đổi prompt, model, tool, giá)
- [ ] Bộ 30 câu ResponseGuard **pass** → 0 số sai lọt ra
- [ ] Nếu đổi prompt/model/KB/bảng giá → chạy lại 200 câu ResponseGuard
- [ ] `judge` chấm: đồng thuận ≥ 90%

### FSM (nếu đổi state/transition)
- [ ] `claim-race.spec` **pass** (50 agent claim cùng lúc → đúng 1 thắng)
- [ ] Mọi transition có trong bảng P14 Brief

### API (nếu thêm endpoint)
- [ ] OpenAPI cập nhật cùng PR
- [ ] Endpoint cài `TenantTx` wrapper
- [ ] `org_id` từ `RequestContext`, không từ body/query
- [ ] Lỗi theo RFC 9457 (`application/problem+json`)
- [ ] Cursor pagination (không offset)
- [ ] POST tạo dữ liệu: có Idempotency-Key

### Queue / Outbox (nếu đổi job, event)
- [ ] Job payload có `orgId` (+ `workspaceId` nếu workspace)
- [ ] Sự kiện ghi `outbox_events` trong cùng transaction
- [ ] Kill worker khi 50 msg/s → 0 msg mất

### Security
- [ ] Không có secret/`.env` trong diff
- [ ] Không hardcode số liệu
- [ ] Nếu thay đổi RLS → kiểm tra policy

### Documentation
- [ ] Nếu đổi API → cập nhật OpenAPI trong cùng PR
- [ ] Nếu đổi FSM → cập nhật P14 Brief
- [ ] Nếu gặp chỗ chưa chốt → ghi vào `QUESTIONS.md`

---

## 📝 Mô tả

### Vấn đề / Yêu cầu

Giải thích ngắn gọn: cái gì thay đổi, tại sao.

### Giải pháp

Cách tiếp cận, quyết định kiến trúc chính.

### Testing

Cách thử nghiệm (hoặc tại sao không cần test).

### Notes

- Bất cứ điều gì cần biết thêm
- Trade-off hoặc hạn chế

---

**PR mà không pass checklist sẽ bị reject.**
