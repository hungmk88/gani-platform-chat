# evals/ — Evaluation & Testing Suite

Bộ test kiểm chứng tính đúng đắn: tenant isolation, FSM race, ResponseGuard, QA.

## Cấu trúc

```
evals/
├── specs/                           — Spec test (integration, race condition)
│   ├── tenant-isolation.spec.ts     — 5 org × 5 agent → chéo tenant = 404
│   ├── workspace-isolation.spec.ts  — Workspace A ≠ Workspace B
│   ├── claim-race.spec.ts           — 50 agent claim cùng lúc → 1 thắng
│   ├── outbox-kill.spec.ts          — Kill queue → event vẫn đi
│   └── fsm-transition.spec.ts       — Tất cả transition hợp lệ
│
├── ai/                              — AI response evaluation
│   ├── response-guard.spec.ts       — 30 câu ResponseGuard (số không lọt)
│   ├── regression.spec.ts           — 200 câu regression (prompt cũ vs mới ≥ 90%)
│   ├── pii-masking.spec.ts          — PII bị che (5 loại: name/dob/phone/email/address)
│   ├── faq-match.spec.ts            — FAQ matching accuracy
│   └── tool-calling.spec.ts         — Tool call format đúng, figure_policy match
│
├── data/                            — Test data & fixtures
│   ├── orgs-5.json                  — 5 tổ chức test
│   ├── workspaces-10.json           — 10 workspace
│   ├── agents-50.json               — 50 agent (5 org × 10 agent)
│   ├── conversations-100.json       — 100 conversation mẫu
│   ├── responses-guard-30.json      — 30 câu ResponseGuard
│   ├── responses-regression-200.json — 200 câu regression
│   └── prompts/                     — Prompt mẫu cho test
│
├── judge/                           — Judge (người hoặc LLM)
│   ├── judge.ts                     — Interface judge abstract
│   ├── llm-judge.ts                 — Claude judge (≥ 90% consensus)
│   ├── human-judge.ts               — Manual judge UI (Playwright)
│   └── scoring.ts                   — Rubric: correctness, tone, format
│
├── ci/                              — CI/CD hooks
│   ├── pre-commit.sh                — Lint prompt format + placeholder validation
│   ├── pr-gate.sh                   — Tất cả spec test phải pass
│   ├── nightly.sh                   — 200 câu regression (cron daily)
│   └── prompt-regression.sh         — Chạy khi thay đổi prompt
│
├── README.md                        — Hướng dẫn chạy test
└── jest.config.js                  — Jest config
```

## Test bắt buộc

### 1. tenant-isolation.spec.ts

```typescript
// Đặc tả
- Tạo 5 org, mỗi org 5 agent
- Mỗi agent tạo 2 hội thoại
- Agent org1 → query org2 = 404 (không 403)
- Agent của org1 workspace A → query workspace B trong org1 = 404
- UPDATE conversation org2 từ agent org1 = 404
- DELETE conversation org2 từ agent org1 = 404
```

**Chạy**: `pnpm test:db:tenant`

### 2. claim-race.spec.ts

```typescript
// Đặc tả
- Tạo 1 conversation ở HUMAN_WAITING_Q
- Khởi chạy 50 agent parallel: `UPDATE ... WHERE state='HUMAN_WAITING_Q' RETURNING id`
- Kiểm chứng: đúng 1 agent thắng (1 dòng trả lại), 49 agent thua (0 dòng)
- Lặp 10 lần → lần nào cũng đúng 1 thắng
```

**Chạy**: `pnpm test:db:claim-race`

### 3. response-guard.spec.ts

```typescript
// Đặc tả
- Chạy 30 câu ResponseGuard từ `data/responses-guard-30.json`
- Mỗi câu:
  - Input: customer message + tools available + figures
  - Expected: response chỉ chứa placeholder `{{...}}`, không số tự do
  - Actual: model output
  - Check: parser → bắt số tự do → fail
- Kết quả: 30/30 pass (0 số tự do lọt ra)
```

**Chạy**: `pnpm test:ai:guard`

### 4. regression.spec.ts

```typescript
// Đặc tả
- Chạy 200 câu trên prompt cũ + mới (từ `data/responses-regression-200.json`)
- Mỗi câu so sánh: response cũ vs response mới
- Judge (LLM hoặc human): tính parity score
  - Đồng ý → +1
  - Khác nhưng chấp nhận → +0.8
  - Khác, giảm chất lượng → -1
- Kết quả: ≥ 90% parity (= ≥ 180 câu pass)
```

**Chạy**: `pnpm test:ai:regression` (nightly, ~1 giờ)

### 5. pii-masking.spec.ts

```typescript
// Đặc tả
- 50 câu có PII (SĐT, email, tên, ngày sinh, địa chỉ)
- Chạy qua `PiiMaskingGuard`
- Check: PII bị che (→ `[REDACTED_PHONE]`, `[REDACTED_EMAIL]`, v.v.)
- Log output: không chứa giá trị thực
- Kết quả: 50/50 pass (0 PII rò)
```

**Chạy**: `pnpm test:ai:pii`

### 6. outbox-kill.spec.ts

```typescript
// Đặc tả
- Tạo 1 event, ghi vào outbox_events
- Commit transaction
- Kill queue worker
- Wait 5s
- Restart worker
- Kiểm chứng: event vẫn được xử lý (không mất)
```

**Chạy**: `pnpm test:db:outbox-kill`

## Judge (LLM hoặc Human)

### LLM Judge

```typescript
class LLMJudge {
  async score(oldResponse, newResponse, rubric): Promise<Score> {
    // Gọi Claude Haiku để chấm
    // Rubric: Correctness, Tone, Format
    // Output: {score: 0-1, reasoning: string}
  }
}
```

### Human Judge (optional)

```bash
# UI tương tác (Playwright E2E)
pnpm run judge:ui
# → Hiển thị câu, oldResponse vs newResponse, nhập score
# → Export kết quả JSON
```

## CI/CD Gates

### PR gate (`pre-commit` + merge check)

```bash
# Khi tạo commit
pnpm run validate:prompts      # Lint prompt metadata + placeholder
pnpm test:db:tenant           # tenant-isolation.spec
pnpm test:db:claim-race       # claim-race.spec (nhanh, 10 lần)
pnpm test:ai:guard            # 30 câu ResponseGuard
```

Nếu fail → PR bị chặn, phải fix.

### Prompt deploy gate

```bash
# Khi merge prompt branch
pnpm test:ai:regression       # 200 câu regression (≥ 90% parity)
# Nếu fail → không được merge
```

### Nightly (cron job)

```bash
# Chạy mỗi 23:00 UTC
pnpm test:ai:regression       # 200 câu (comprehensive)
pnpm test:ai:pii              # 50 câu PII
pnpm test:db:*                # Tất cả spec
# Report → Slack #ai-evals
```

## Cách chạy test

### Một spec riêng

```bash
pnpm test -- tenant-isolation.spec.ts
```

### Toàn bộ integration

```bash
pnpm test:db
```

### AI regression (comprehensive)

```bash
pnpm test:ai:regression --verbose
```

### Local dev (hot reload)

```bash
pnpm test:watch tenant-isolation.spec.ts
```

## Khi fail

| Fail | Hành động |
|---|---|
| `tenant-isolation` fail | Kiểm tra RLS policy, app_role context |
| `claim-race` fail | Kiểm tra transaction isolation level, UPDATE atomic |
| `ResponseGuard` fail | Kiểm tra số trong response, prompt + tool definition |
| `Regression` < 90% | Không merge prompt. Sửa prompt, retry. Nếu không được → roll back cũ. |
| `PII` fail | Kiểm tra regex masking, encoding |

## Monitoring production

Khi deploy, giám sát:
- `ai.number_mismatch` log count (nếu > 5/hour → rollback prompt)
- RLS violation (nếu có → ALERT CRITICAL)
- Claim race failure (nếu có → bug trong FSM)
- PII log (nếu có → ALERT CRITICAL)

## Ghi chú

- Spec test: chạy nhanh (< 5s mỗi cái), merge gate
- Regression: chạy lâu (1–2 giờ), nightly + before deploy
- Judge score: ≥ 90% = pass, < 90% = nghi ngờ (manual review)
