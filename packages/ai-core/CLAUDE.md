# packages/ai-core — AI Gateway, Guard, PII

Service nghiệp vụ KHÔNG BAO GIỜ gọi provider trực tiếp.
Chỉ gọi `AiRouter`. `AiRouter` gọi AI Gateway tự host.

## ResponseGuard — số liệu qua ô giữ chỗ

- Câu trả lời khách có số nghiệp vụ → model CHỈ viết `{{price_1}}`, `{{moq_1}}`,
  `{{delivery_slot_1}}`. Hệ thống tự điền số thật từ `ToolResult.figures`.
- Model viết số tự do → chặn, thử lại **1 lần** với chỉ dẫn chặt hơn.
  Vẫn vi phạm → không gửi, chuyển người, log `ai.number_mismatch`.
- Model **bị cấm tự hứa thời gian** ("em kiểm tra trong 2 phút" → "em kiểm tra ngay").
  Mọi cam kết thời gian phải từ `{{agent_eta}}`, `{{business_hours}}`.

## figure_policy trong front-matter prompt

- `placeholder_only` — trả lời khách (bắt buộc qua ô giữ chỗ).
- `source_only` — thẻ tóm tắt, số lấy từ `conversation_ai_state`, không lấy từ chữ model.
- `free` — phân loại, trích xuất.
- `none` — tác vụ không sinh chữ cho người đọc.

## Cache & stream

- Câu có kết quả tool: **không cache, không stream**.
- Chỉ cache FAQ tĩnh, key = `org:{orgId}:ws:{wsId}:faq:<hash>:kb<v>:price<v>`.
- Chỉ stream trên widget web và chỉ khi `containsFigures = false`.

## PII masking (bật từ đợt 1)

- Che: họ tên người, ngày sinh, SĐT, email, địa chỉ chi tiết, MST, số TK, CCCD.
- **Không che** tên quán/doanh nghiệp (cần cho báo giá B2B).
- Giải mã ngược sau guard để bot vẫn xưng hô đúng.

## Kiểm chứng

- `pnpm test:ai` chạy 30 câu ResponseGuard → phải **0 số sai lọt ra**.
- Đổi prompt/model/KB/bảng giá → **chạy lại toàn bộ bộ test 200 câu**.
- `judge` chấm bộ test: đồng thuận với người ≥ 90%, nếu không → nâng lên tầng medium.
