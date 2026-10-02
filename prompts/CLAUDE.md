# prompts/ — Thư viện prompt

Nguồn chuẩn: Brief P6 (cấu trúc, phiên bản), P11, P11.1 (ResponseGuard) · Phụ lục v2.1 §4–6, v2.3 §25.

Prompt chỉ được đọc từ `prompts/` + bảng `prompt_versions`. Không viết prompt trực tiếp trong code.

## Cấu trúc và đặt tên

Theo template và tác vụ, phiên bản semver (Brief P6):

```
prompts/<template>/<task>@<semver>.md
# ví dụ: prompts/b2b/answer@1.2.0.md   ← cùng chuỗi dùng làm AiTaskRequest.promptRef
```

`<template>` ∈ `b2b`, `b2c`, `service`, `common`. Cấu trúc thư mục con theo tác vụ do P11 quyết định; **không tạo trước** các tệp chưa có tác vụ thật.

## Metadata (front-matter bắt buộc)

```yaml
---
id: b2b/answer
version: 1.2.0
figure_policy: placeholder_only   # placeholder_only | source_only | free | none
requires_tools: [get_price]       # danh sách đóng
changelog:
  - 1.2.0: "…"
---
```

`figure_policy` (P11.1):
- `placeholder_only` — trả lời khách; số nghiệp vụ chỉ qua ô giữ chỗ.
- `source_only` — thẻ tóm tắt; số lấy từ `conversation_ai_state`, không lấy từ chữ model.
- `free` — phân loại, trích xuất.
- `none` — tác vụ không sinh chữ cho người đọc.

`requires_tools` là **danh sách đóng**: prompt gọi tool ngoài danh sách → `validate:prompts` báo lỗi.

**Tham số model (temperature, max tokens, schema đầu ra) KHÔNG nằm trong prompt** — nằm trong config `model_routes` theo từng model (v2.3 §25).

## Ô giữ chỗ số liệu

- Model chỉ viết `{{price_1}}`, `{{moq_1}}`, `{{delivery_slot_1}}`, `{{agent_eta}}`, `{{business_hours}}`. Hệ thống điền số thật từ `ToolResult.figures`.
- Tên ô giữ chỗ phải được định nghĩa; ô lạ (typo) → `validate:prompts` báo lỗi.
- **Cấm tự hứa thời gian** ("em kiểm tra trong 2 phút"); mọi cam kết thời gian qua `{{agent_eta}}` / `{{business_hours}}`.

## Tool definitions

- Định nghĩa tool độc lập nhà cung cấp (JSON Schema); AI Gateway (LiteLLM-compatible) chuyển đổi sang định dạng của từng provider.
- Mỗi tool khai báo `figure_policy`. Tool trả giá/tổng tiền trả về `ToolResult` có `figures`, không trả số trong chữ.
- Danh sách tool cụ thể do module 05 quyết định theo đợt (đợt 2: `get_price`, `generate_quote`; đợt 3: `calculate_order`, `create_order`). Prompt không được gọi tool không tồn tại.

## Phiên bản & thay đổi

- Đổi prompt → tăng semver + changelog; prompt đang chạy không xóa, chỉ thay phiên bản.
- **Cải tiến prompt bằng đánh giá offline trên bộ test + chạy ẩn trên dữ liệu thật. Không A/B test** (v2.3 §25).
- Mỗi lần đổi prompt/model/KB/bảng giá phải chạy lại bộ test (Brief P20: 200 câu/workspace, 3 lần/câu, 3 lớp chấm, 20% câu ẩn với vendor; thêm 30 câu số tự nhiên cho ResponseGuard). Ngưỡng đạt do Test Specification quyết định (Brief P21 S12: ≥ 95% và 0 số sai trên staging), không tự đặt ngưỡng ở file này.
- Kiểm tra định dạng: `pnpm validate:prompts` (front-matter + ô giữ chỗ).

## Prompt caching

- Đặt phần tĩnh ở đầu: system prompt + định nghĩa tool + khối `conversation_state` + 6–8 lượt gần nhất (Phụ lục §16) để tận dụng prompt caching của provider.
- Không tự dựng cache prompt riêng. Cache FAQ (nếu có) theo `ai-core/cache`: khóa `org:{orgId}:ws:{wsId}:faq:<hash>:kb<v>`; **không cache câu có kết quả tool**.

## Cấm
- Hardcode số liệu (giá, MOQ, thời gian) trong prompt.
- Nêu tên model/nhà cung cấp trong nội dung prompt (model nằm trong config).
- Dùng hội thoại thật để huấn luyện/fine-tune (Phụ lục §28).
- Sửa prompt mà không chạy bộ test.
