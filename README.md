# Gani Platform Chat — Nền tảng Chat & AI Chatbot Đa Tenant

Nền tảng trò chuyện AI tích hợp cho 5 công ty, hỗ trợ multi-workspace, real-time collaboration, và quản lý hội thoại toàn diện.

## Cấu trúc dự án

```
gani-platform-chat/
├── packages/
│   ├── db/              — Schema, migration, RLS policies
│   └── ai-core/         — AI Router, ResponseGuard, PII masking
├── apps/
│   ├── api/             — REST API, FSM, domain modules
│   ├── worker/          — Queue, outbox, scheduler
│   ├── admin/           — Admin UI (5 menu groups)
│   └── widget/          — Embeddable chat widget
├── docs/                — Brief v0.4, Acceptance Criteria
├── .claude/
│   └── settings.json    — Production safety locks
└── CLAUDE.md            — Quy tắc cốt lõi (đọc trước)
```

## Bắt đầu

### 1. Đọc trước

- `CLAUDE.md` — Quy tắc cốt lõi (50 dòng)
- `docs/implementation-brief.md` — Brief v0.4 (đầy đủ yêu cầu)

### 2. Workflow với Claude Code

**Mọi yêu cầu code:**

```
Shift+Tab × 2  →  vào Plan Mode
Đọc code + Brief, trình phương án
(Chờ duyệt)
Shift+Tab  →  thoát Plan Mode
Code
```

### 3. Kiểm chứng

```bash
pnpm install
pnpm test
pnpm lint
pnpm typecheck
pnpm test:db            # tenant-isolation.spec, workspace-isolation.spec
pnpm test:ai            # 30 câu ResponseGuard
pnpm test:claim-race    # 50 agent claim cùng lúc
```

### 4. PR

- ≤ 400 dòng
- Conventional Commits
- OpenAPI cập nhật nếu đổi endpoint
- Tất cả test pass

## 5 Quy tắc Không Thể Thỏa Hiệp

1. `org_id` chỉ từ session/API key/job payload
2. PK: UUIDv7 (không UUIDv4)
3. Số nghiệp vụ: placeholder `{{price_1}}`, không tự sinh
4. FSM: chỉ qua `ConversationStateMachine`
5. Log: không PII (chỉ messageId, traceId, orgId, workspaceId)

## Khi cần giúp

- `QUESTIONS.md` — ghi những chỗ chưa chốt
- `# ` vào file `CLAUDE.md` con — nếu lặp lại cùng lỗi 2 lần

## Tài liệu

- `docs/implementation-brief.md` — Spec đầy đủ (Brief v0.4 + Phụ lục)
- `packages/db/CLAUDE.md` — Schema & RLS
- `packages/ai-core/CLAUDE.md` — AI Guard & PII
- `apps/api/CLAUDE.md` — API & FSM
- `apps/worker/CLAUDE.md` — Queue & Outbox
- `apps/admin/CLAUDE.md` — UI Admin
- `apps/widget/CLAUDE.md` — Embedded widget

## Liên hệ

Yêu cầu code → vào Plan Mode trước. Không chắc gì → ghi vào `QUESTIONS.md`.
