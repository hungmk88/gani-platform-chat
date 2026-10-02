# Gani Foods Platform — Quy tắc cốt lõi

Nền tảng Chat & AI Chatbot đa tenant cho 5 công ty.
Đọc `docs/implementation-brief.md` (Brief v0.4) trước khi làm bất cứ việc gì.
Hồ sơ gốc + Phụ lục v2.1–v2.3 thắng Brief khi mâu thuẫn.

## CÁCH LÀM VIỆC (bắt buộc)

1. Mọi yêu cầu code → **vào Plan Mode trước** (Shift+Tab ×2).
   Đọc code, hiểu ngữ cảnh, trình phương án. KHÔNG code ở lượt đầu.
2. Chờ tôi duyệt phương án rồi mới code.
3. Chia PR ≤ 400 dòng. Trunk-based. Conventional Commits.
4. Gặp chỗ chưa chốt trong Brief → ghi vào `QUESTIONS.md`, KHÔNG tự đoán.

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
