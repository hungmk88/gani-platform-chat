# Checklist trước khi gọi Claude Code — PR0

> **Deadline:** Hôm nay (03/10/2026) hoặc tối. Sau xong bấm dấu vào hết, dán `tree /F` lên để tôi xác nhận.

---

## ✅ Việc 1: Sửa `infra/CLAUDE.md` (HỎI — XỬ XONG)

- [x] Xóa mọi dòng nhắc K8s
- [x] Thay bằng Docker + ECS + Terraform
- [x] Thêm note: chỉ chuyển K8s khi vượt 50k hội thoại/tháng

**Status:** ✅ XỬ XONG

---

## ✅ Việc 2: Điền Brief v0.4 thật vào `docs/implementation-brief.md` (CẤP BẮC)

Hiện tại file trong repo là **template 8 phần** (không phải Brief thật). Anh cần:

1. Mở file Brief v0.4 **gốc** (có sẵn trong cuộc trò chuyện này hoặc trong Downloads)
2. **Copy toàn bộ nội dung** (từ P1 đến P22)
3. **Dán vào** `E:\GANI BRAINSTORM\gani-platform-chat\docs\implementation-brief.md` — **ghi đè template**
4. **Kiểm tra:** mở file → `Ctrl+End` → phải thấy "**P22 — Câu hỏi cho chủ đầu tư**"

- [ ] Tìm được file Brief v0.4 gốc
- [ ] Copy toàn bộ nội dung
- [ ] Dán vào docs/implementation-brief.md
- [ ] Kiểm tra P22 có ở cuối không

**Ước lượng:** 10–15 phút (nếu find-paste nhanh)

---

## ✅ Việc 3: Tạo 4 file Phụ lục + 1 danh sách tính năng (CẤP BẮC)

Tạo 5 file mới trong thư mục `docs/`:

### File 1: `docs/phu-luc-v2.1.md` — Kỹ thuật & Tool stack
- Copy nội dung "Phụ lục v2.1 — Kỹ thuật" từ cuộc trò chuyện
- Dán vào file

- [ ] `docs/phu-luc-v2.1.md` — tạo xong

### File 2: `docs/phu-luc-v2.2.md` — Bảng endpoint & Mã lỗi
- Copy nội dung "Phụ lục v2.2 — Bảng endpoint" từ cuộc trò chuyện
- Dán vào file

- [ ] `docs/phu-luc-v2.2.md` — tạo xong

### File 3: `docs/phu-luc-v2.3.md` — Permission & Webhook
- Copy nội dung "Phụ lục v2.3 — Permission & Webhook" từ cuộc trò chuyện
- Dán vào file

- [ ] `docs/phu-luc-v2.3.md` — tạo xong

### File 4: `docs/danh-sach-109-tinh-nang.md` — Đủ 109 tính năng
- Copy nội dung "Danh sách 109 tính năng" từ cuộc trò chuyện
- Dán vào file

- [ ] `docs/danh-sach-109-tinh-nang.md` — tạo xong

**Ước lượng:** 20 phút (4 × copy-paste)

---

## ✅ Việc 4: Git init lần đầu (CẤP BẮC)

Mở PowerShell, chạy lệnh theo trình tự:

```powershell
cd "E:\GANI BRAINSTORM\gani-platform-chat"

git init
git add .
git commit -m "chore: khởi tạo repo + 17 file CLAUDE.md + Brief v0.4 + 5 phụ lục

- Setup CLAUDE.md gốc (50 dòng, 5 quy tắc)
- 9 CLAUDE.md con (db, ai-core, api, worker, admin, widget, prompts, evals, infra)
- .claude/settings.json (khóa production)
- .github/pull_request_template.md (13-point checklist)
- docs/implementation-brief.md (Brief v0.4)
- 4 file phụ lục v2.1–v2.3 + danh sách 109 tính năng
- README.md + QUESTIONS.md

Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>"
```

- [ ] `git init` thành công
- [ ] `git add .` thêm toàn bộ file
- [ ] `git commit` lưu lần đầu

**Ước lượng:** 2 phút

---

## ✅ Việc 5: Tạo GitHub org `gani-foods` (TỰA CHỌN, NẾU CHƯA CÓ)

Nếu chưa có GitHub org `gani-foods`:

1. Vào https://github.com/new
2. Tạo organization mới tên `gani-foods`
3. Kích hoạt branch protection trên `main`

Nếu **đã có** org → bỏ qua.

- [ ] GitHub org `gani-foods` tồn tại hoặc đã tạo
- [ ] (Optional) Branch protection: PR cần CI pass + 1 reviewer

**Ước lượng:** 5 phút (hoặc 0 nếu đã có)

---

## ✅ Việc 6: Push lên GitHub (CẤP BẮC)

Tiếp tục PowerShell (hoặc terminal mới):

```powershell
cd "E:\GANI BRAINSTORM\gani-platform-chat"

git remote add origin https://github.com/gani-foods/gani-platform-chat.git
git branch -M main
git push -u origin main
```

Kiểm tra: vào https://github.com/gani-foods/gani-platform-chat → phải thấy tất cả file.

- [ ] `git remote add origin` thành công
- [ ] `git push -u origin main` push xong
- [ ] GitHub repo có tất cả 17 file

**Ước lượng:** 2 phút

---

## ✅ Việc 7: Gọi Claude Code + gửi prompt PR0 (CẤP BẮC)

Mở PowerShell:

```powershell
cd "E:\GANI BRAINSTORM\gani-platform-chat"
claude
```

Chờ Claude khởi động. Nhấn `Shift + Tab` hai lần để vào **Plan Mode** (dòng status sẽ hiện "plan mode").

Dán prompt này:

```
Đọc 3 file:
- CLAUDE.md (50 dòng, 5 quy tắc)
- docs/implementation-brief.md (Brief v0.4)
- QUESTIONS.md (10 câu từ S1)

Sau đó, hãy **chỉ trình phương án** (không code). Phương án PR0:

1. Tạo 4 ADR (Architecture Decision Record):
   - ADR-0001: Monorepo + pnpm + Turborepo
   - ADR-0002: ORM = Drizzle
   - ADR-0003: Auth = Better Auth
   - ADR-0004: RLS fail-loud + 3 role DB

2. Tạo đặc tả chi tiết:
   - docs/specs/rls-and-db-roles.md (RLS policy đầy đủ, P8 M01)
   - docs/specs/schema-m01.sql (Bảng khung S1)
   - docs/specs/auth-flow.md (JWT + session)

3. Cập nhật QUESTIONS.md:
   - Ghi những chỗ chưa chốt (N0–N10)
   - Đánh dấu câu nào chặn PR0 vs không

4. Setup CI/CD:
   - .github/workflows/ci.yml (lint + test + typecheck)
   - Yêu cầu 1 reviewer trên branch protection

**Không code trong phiên này. Chỉ trình phương án.**
```

Chờ Claude trình xong → anh đọc → chốt (hoặc sửa ý kiến) → sau đó tôi code PR0.

- [ ] Mở Claude Code trong repo
- [ ] Vào Plan Mode (Shift+Tab ×2)
- [ ] Dán prompt PR0 vào
- [ ] Chờ Claude trình xong

**Ước lượng:** 1–2 phút gửi, 5–10 phút Claude trình

---

## 📊 Tóm tắt công việc

| # | Việc | Xong? | Thời gian | Chặn |
|---|---|---|---|---|
| 1 | Sửa infra/CLAUDE.md | ✅ | 1 phút | Không |
| 2 | Điền Brief v0.4 | ⬜ | 10 phút | **PR0** |
| 3 | Tạo 4 phụ lục | ⬜ | 20 phút | **PR0** |
| 4 | Git init | ⬜ | 2 phút | Không |
| 5 | Tạo GitHub org | ⬜ | 5 phút | (Optional) |
| 6 | Git push | ⬜ | 2 phút | Không |
| 7 | Gọi Claude + PR0 | ⬜ | 5 phút | Không |
| **TỔNG** | | | **~45 phút** | |

---

## 🎯 Khi xong hết 7 việc

Dán output sau lên đây:

```
Xong 7 việc. Output:
- Brief v0.4 trong docs/ ✓
- 4 phụ lục trong docs/ ✓
- GitHub repo: gani-foods/gani-platform-chat ✓
- Đã gọi Claude Code, đang ở Plan Mode PR0
```

Tôi sẽ xác nhận, rồi anh cho phép Claude code PR0.

---

## 📌 Lưu ý

- Khi paste prompt PR0, **đừng sửa gì cả** — dùng y đúc như trên
- Nếu Claude hỏi thêm → đó là tốt, đó là Claude yêu cầu làm rõ. Anh trả lời.
- **Không** thoát Plan Mode trước khi Claude trình xong phương án
