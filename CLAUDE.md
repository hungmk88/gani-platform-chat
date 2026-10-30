# Gani Foods Platform — Quy tắc cốt lõi

Nền tảng Chat & AI Chatbot đa tenant cho 5 công ty.
Đọc `docs/brief-backend-core-v1.0.md` (Brief Backend & Core v1.0) trước khi làm bất cứ việc gì.
`docs/implementation-brief.md` (v0.4) đã bị thay thế, chỉ giữ làm lịch sử.
Hồ sơ gốc + Phụ lục v2.1–v2.3 thắng Brief khi mâu thuẫn.

## CÁCH LÀM VIỆC (bắt buộc)

1. Mọi yêu cầu code → **vào Plan Mode trước** (Shift+Tab ×2).
   Đọc code, hiểu ngữ cảnh, trình phương án. KHÔNG code ở lượt đầu.
2. Chờ tôi duyệt phương án rồi mới code.
3. Chia PR ≤ 400 dòng (mục tiêu, xem "KÍCH THƯỚC PR"). Trunk-based. Conventional Commits.
4. Gặp chỗ chưa chốt trong Brief → ghi vào `QUESTIONS.md`, KHÔNG tự đoán.

## GIT WORKFLOW

### Nhánh và PR

- Mỗi PR làm trên branch riêng:
  - `feat/<mô-tả>`, `fix/<mô-tả>`, `chore/<mô-tả>`, `docs/<mô-tả>`, `test/<mô-tả>`
- KHÔNG commit trực tiếp lên `main`.
- KHÔNG `push --force` lên `main`.
- KHÔNG amend commit đã push.
- Sau khi push branch, báo URL cho anh.
- **Phân tầng merge (áp dụng cho FE và BE)** (CEO 31/10):
  - Tầng 1/2 — docs, chỉ đọc, test, fix nhỏ, thao tác ghi thông thường (POST/PATCH/DELETE lên API không gây hậu quả không
    hoàn tác): DEV tự merge sau khi required check xanh.
  - Tầng 3 — thao tác không hoàn tác được: CEO merge sau khi DEV gửi "Sẵn sàng merge" kèm HEAD + job +
    `mergeable_state = clean`, và CEO comment phê duyệt vào PR trước khi bấm merge.
    - FE: xóa dữ liệu khách (B2), hạ mức tự chủ (màn 2).
    - BE: do BE lead định nghĩa trong tài liệu BE. Tầng 3 của BE (migration xóa dữ liệu, đổi schema phá vỡ, …) do BE lead định
      nghĩa trong tài liệu BE; nguyên tắc áp dụng ngay từ khi luật có hiệu lực.
- Kèm theo phân tầng (CEO 31/10):
  - Mọi PR mở ở draft. Tầng 1/2: DEV tự chuyển ready ngay trước khi tự merge, trong cùng một lượt. Draft không thay required
    check, phải có cả hai.
  - Tầng 1/2: DEV tự kiểm đủ mọi job của `.github/workflows/ci.yml` (của `main`) theo tên, xanh trên đúng HEAD; required
    check chỉ là lưới an toàn cuối. Sau merge báo HEAD, tên từng job, thời điểm, diff giữa HEAD và commit squash.
  - "Ready" ≠ "xong": PR rời draft không phải tín hiệu merge.
  - PR sửa file của bộ phận khác phải có review của bộ phận đó, kể cả comment.
  - Chi tiết và lịch sử: `docs/ui/session-summary-29-10.md` mục 2; required check `lint, typecheck, test` và `enforce_admins`: U71.

### Quy trình mỗi PR

1. `git checkout main && git pull`
2. `git checkout -b feat/pr3-tenancy-tables`
3. [viết code, chạy lint/typecheck/test]
4. `git add . && git commit -m "feat(db): ..." -m "Co-Authored-By: Claude <noreply@anthropic.com>"`
5. `git push -u origin feat/pr3-tenancy-tables`
6. Mở PR ở draft, báo anh URL PR + tóm tắt thay đổi
7. CI chạy → merge theo phân tầng ở trên
8. `git checkout main && git pull`

Lưu ý trước bước 4: chạy `git status` và `git diff --stat`, chỉ để lại file thuộc PR này
(không `.env`, không file do công cụ tự sinh ở root).

## KÍCH THƯỚC PR

- **≤ 400 dòng là mục tiêu, không phải trần cứng** (không tính file sinh tự động). Mỗi file ≤ 500 dòng.
- Vượt 400: **báo trước khi push**, kèm số dòng, lý do không tách được và phương án tách. Anh quyết giữ hay tách.
  Đã có ca được chấp nhận ở 454–464 dòng vì tách ra làm mất tính nguyên tử.
- Tách theo ranh giới nghiệp vụ: mỗi PR đứng một mình và CI xanh; không cắt đôi một thay đổi cho vừa số dòng.
- PR báo cáo rà soát (docs): mỗi file ≤ 400 dòng, cả PR ≤ 450.
- Nguồn: N126 trong `QUESTIONS.md`.

## 5 QUY TẮC KHÔNG THỂ THỎA HIỆP

1. `org_id` không bao giờ lấy từ client. Chỉ từ session/API key/job payload.
2. Mọi PK dùng **UUIDv7**, không dùng UUIDv4.
3. Số nghiệp vụ (giá/tổng tiền/MOQ/cam kết thời gian) phải từ tool;
   model chỉ viết `{{price_1}}` — không tự sinh số.
4. Đổi trạng thái hội thoại phải qua `ConversationStateMachine`.
   Cấm `UPDATE conversations SET state = ...` trực tiếp.
5. Không log PII (SĐT/email/nội dung tin/MST/số TK).
   Chỉ log `messageId`, `traceId`, `orgId`, `workspaceId`.

## KIỂM CHỨNG (phải pass trước khi báo "xong")

- `pnpm test && pnpm lint && pnpm typecheck` — CI phải xanh.
- Thay đổi RLS → chạy `tenant-isolation.spec`: thiếu tenant context phải **báo lỗi**
  (fail-loud), không trả 0 dòng im lặng.
- Thay đổi FSM → chạy `claim-race.spec`: 50 agent claim cùng lúc → **đúng 1 thắng**.
- Thay đổi AI/Giá → chạy bộ 30 câu ResponseGuard, phải **0 số sai lọt ra**.
- Không chứng minh được → báo chưa xong, không tự suy đoán kết quả.

## KHÓA PRODUCTION (không được vi phạm)

- Không kết nối production từ môi trường local/AI.
- Không chạy `seed` ngoài `dev`/`staging` — script phải tự chặn ở prod.
- Không DELETE/TRUNCATE/DROP nếu chưa xác nhận với người.
- Không commit `.env`, secret, credentials. Chỉ `.env.example`.
- Không tự ý deploy. Deploy qua CI/CD, không qua AI.

## CHIẾN LƯỢC MODEL

- Mặc định: `sonnet` (Sonnet 5.5) cho dev hằng ngày.
- Kiến trúc phức tạp / refactor nhiều file / bug khó: gõ `/model opus`.
- Review hàng loạt / sub-agent: gõ `/model haiku`.
- Cùng vấn đề mà 3 lần chưa xong → chuyển `/model opus`, không đốt token.

## QUY ƯỚC THƯ MỤC CON (đọc khi làm trong đó)

- `packages/db/CLAUDE.md` — schema, migration, RLS policy.
- `packages/ai-core/CLAUDE.md` — router, guard, PII masking.
- `apps/api/CLAUDE.md` — domain module, FSM transition, endpoint.
- `apps/worker/CLAUDE.md` — queue, outbox, scheduler, job tenant.
- `apps/admin/CLAUDE.md` — UI admin, 5 nhóm menu, design token.
- `apps/widget/CLAUDE.md` — loader nhẹ, Shadow DOM, brand per workspace.
- `prompts/CLAUDE.md` — system prompt, tool definitions, few-shots, figure_policy.
- `evals/CLAUDE.md` — bộ chạy Test Specification AI (ResponseGuard, 200 câu, PII); dataset không nằm trong repo.
- `infra/CLAUDE.md` — Terraform (module không gắn cloud, chưa apply), Docker, PITR, role DB.

## CẤM

- Không commit file do công cụ tự sinh ở root (`AGENTS.md`, `.cursorrules`, v.v.).
- Turbo: `turbo.json` phải có `"agentGuidance": false` (tắt tự sinh `AGENTS.md`).
- Turbo telemetry: tắt bằng `turbo telemetry disable` (toàn cục, mỗi máy một lần); CI đặt `TURBO_TELEMETRY_DISABLED=1`. **Không thêm khóa `telemetry` vào `turbo.json`** (`turbo` báo `unknown key` và từ chối chạy).

## COMMIT MESSAGE

- Conventional Commits.
- Dòng cuối: `Co-Authored-By: Claude <noreply@anthropic.com>` cho mọi commit có AI hỗ trợ.
- Bắt buộc có `< >` để GitHub nhận diện.

## KHI BỊ SỬA CÙNG MỘT LỖI LẦN 2

Nhấn `#` để thêm quy tắc vào file này.
Đây là cách duy nhất để không lặp lại lỗi cũ.

## BẢO MẬT TÀI LIỆU

**Không bao giờ ghi giá trị thật của secret vào `.md`, `.txt`, spec, note, commit message, PR description.**

### Được / Không được

| ❌ KHÔNG | ✅ ĐƯỢC |
|----------|---------|
| `postgresql://user:pass@host` | `<đặt ở .env.test>` |
| `npg_xxxxx`, `sk-ant-xxxxx`, `ghp_xxxxx` | `DATABASE_URL_APP`, `app_role` |
| Private key, cert, token | Placeholder `<...>` |

### Cách viết đúng

```markdown
❌ DATABASE_URL_APP=postgresql://app_role:xxxx@host/db   # mật khẩu viết thẳng vào tài liệu
✅ DATABASE_URL_APP=<đặt ở .env.test>
✅ Connection: xem `.env.test` (đã trong .gitignore)
```

### Scan trước khi push

```powershell
git grep -i -E "npg_|sk-|sk-ant-|AIza|AKIA|ghp_|PASSWORD="
Get-ChildItem -Recurse -File -Exclude "*.git*","node_modules" |
  Select-String -Pattern "npg_|sk-|sk-ant-|AIza|AKIA|ghp_"
```

Có kết quả → **DỪNG**.

### Khi secret lộ — 5 bước

1. Dừng ngay
2. **Rotate** credential (Neon/AWS/provider)
3. Update `.env.test` local
4. Sửa tài liệu → placeholder
5. Scan repo + ghi nhận vào Session Summary

### Định kỳ

- Cuối session lớn: scan repo
- Trước paste tài liệu cho AI khác: đọc lại
- Trước push public: scan

## KIỂM TRA LỆNH — KHÔNG PIPE CHE EXIT CODE

**Exit code của pipeline = exit code của command CUỐI.**

### Ví dụ SAI

```bash
pnpm test | grep "FAIL"     # ❌ grep thấy → exit 0, tưởng pass dù test fail
pnpm lint | tail -1         # ❌ tail luôn exit 0
```

### Ví dụ ĐÚNG

```bash
# Cách 1 — redirect + đọc exit code (khuyến nghị)
pnpm test > test.log 2>&1; echo "exit=$?"

# Cách 2 — pipefail
set -o pipefail; pnpm test | grep "FAIL"
```

PowerShell:
```powershell
pnpm test; echo "exit=$LASTEXITCODE"
```

### Quy tắc

1. **Không** kết thúc lệnh kiểm bằng `| grep` hoặc `| tail` không có `pipefail`/`PIPESTATUS`.
2. **Luôn** báo exit code thật khi pre-flight.
3. **Không** viết "test pass" mà không có số liệu.

### Report đúng format

```
| Lệnh | Exit | Ghi chú |
|------|------|---------|
| pnpm lint | 0 | |
| pnpm --filter @gani/db test | 0 | 47 test, coverage 100% funcs |
| pnpm --filter @gani/api test | 1 | SWC lỗi (N42) — giới hạn local |
```

## LỊCH SỬ

Nhật ký thay đổi quy tắc: `docs/claude-changelog.md`.
