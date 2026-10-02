# prompts/ — Prompt Library & System Messages

Tập trung các prompt, few-shot examples, tool definitions cho AI model.
Mỗi prompt phải có `figure_policy` rõ ràng (placeholder_only / source_only / free / none).

## Cấu trúc

```
prompts/
├── system/                          — System prompts (không thay đổi thường xuyên)
│   ├── bot-conversation.md          — Chatbot trò chuyện với khách
│   ├── bot-classification.md        — Phân loại ý định khách
│   ├── bot-transfer-decision.md     — Quyết định đưa sang agent
│   └── support-agent.md             — Hướng dẫn agent xử lý
│
├── tools/                           — Tool definitions (OpenAI format)
│   ├── fetch-price.json             — Lấy bảng giá
│   ├── search-kb.json               — Tìm kiếm knowledge base
│   ├── check-inventory.json         — Kiểm tra tồn kho
│   └── create-quote.json            — Tạo báo giá
│
├── few-shots/                       — Few-shot examples per use case
│   ├── classification-examples.md   — Ví dụ phân loại
│   ├── transfer-decision.md         — Ví dụ quyết định chuyển
│   └── pricing-response.md          — Ví dụ trả lời giá
│
├── kb-instructions/                 — Hướng dẫn sử dụng knowledge base
│   └── search-strategy.md           — Cách tìm kiếm hiệu quả
│
└── README.md                        — Hướng dẫn version control prompt
```

## Quy tắc

### 1. Mỗi prompt phải có metadata

```yaml
---
id: bot-conversation-v2
name: Bot Conversation (Responsive)
figure_policy: placeholder_only
version: 2
deprecated_at: null
changelog:
  - v2: "Thêm instruction về hỗ trợ chéo sản phẩm"
  - v1: "Initial"
---

<nội dung prompt>
```

### 2. Placeholder cho số liệu

- Bảng giá: `{{price_<tool_id>}}`
- MOQ: `{{moq_<tool_id>}}`
- ETA: `{{agent_eta}}`
- Giờ làm việc: `{{business_hours}}`
- FAQ match: `{{faq_match.score}}`

### 3. Tool definitions

Mỗi tool định nghĩa `figure_policy`:

```json
{
  "name": "fetch_price",
  "figure_policy": "placeholder_only",
  "description": "Lấy bảng giá, trả về dạng {{price_N}}, KHÔNG phải số thực",
  "parameters": {
    "type": "object",
    "properties": {
      "product_id": {"type": "string"},
      "quantity_tier": {"type": "integer"}
    }
  }
}
```

### 4. Few-shot examples

Mỗi example có:
- **Input**: customer message
- **Reasoning**: Claude thinking (nội bộ)
- **Output**: expected response (với placeholder hoặc action)

### 5. Version control

- Prompt thay đổi → cập nhật version + changelog
- Prompt deprecated → đánh dấu `deprecated_at`, update migration plan
- Prompt active → không được xóa, chỉ deprecate
- Kiểm tra: `pnpm run validate:prompts` (lint metadata + placeholder)

### 6. Kiểm chứng

Trước deploy prompt mới:
- `pnpm test:ai:prompts` — Chạy 30 câu test trên prompt mới
- `pnpm test:ai:regression` — 200 câu regression vs prompt cũ (≥ 90% parity)
- `judge` chấm: so sánh kết quả (blind test tối thiểu 50 câu)

## Cấm

- Không hardcode số liệu (giá, MOQ, thời gian)
- Không tự hứa cam kết thời gian ("em sẽ kiểm tra trong 2 phút")
- Không yêu cầu tool không tồn tại trong `tools/*.json`
- Không để placeholder không được định nghĩa (typo `{{price_typo}}` → báo lỗi)

## Migration prompts cũ

Nếu deprecated prompt cũ:
1. Tạo phiên bản mới, set `version++`
2. Chạy regression 200 câu
3. Deploy mới trước → rollback nếu fail
4. Chỉ khi ≥ 90% parity mới tắt prompt cũ
5. Giữ prompt cũ ≥ 2 tuần cho monitoring
6. Sau đó: xóa hoặc archive

## Prompt caching (Anthropic)

- System prompt tĩnh: cache với key `org:{orgId}:ws:{wsId}:system:v<N>`
- Few-shots tĩnh: cache riêng, update khi công ty thay đổi knowledge
- Tool definitions: cache (cộng chung với system cache)
- TTL: 5 phút (mặc định Anthropic)

## Contacts

Khi có vấn đề về prompt:
- Không hiểu ý khách? → sửa few-shots, không sửa system prompt
- Model vi phạm figure_policy? → tăng urgency trong system prompt + thêm ví dụ
- Lặp lại 2 lần? → ghi vào `#` trong file này
