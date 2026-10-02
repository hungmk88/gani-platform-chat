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

- Che: **họ tên cá nhân**, ngày sinh, SĐT, email, địa chỉ chi tiết, MST, số TK, số giấy tờ (CCCD…) → `[NAME_1]`, `[PHONE_1]`, `[TAX_ID_1]`…
- **Không che** tên doanh nghiệp/quán và tên thương hiệu (cần cho báo giá B2B).
- Khách `business`: che tên người liên hệ, giữ tên doanh nghiệp. Văn bản tự do: phần chứa tên doanh nghiệp đã biết thì giữ; phần còn lại nghi là tên người thì che. Chấp nhận sót ±5%. Nếu độ tin cậy có PII > 90% → che cả câu (sẽ ghi vào spec M03).
- Phân biệt cá nhân/doanh nghiệp qua `customers.type` (`individual` · `business`). Ai đặt `type` khi tạo khách: câu hỏi mở (`QUESTIONS.md`).
- Giải mã ngược sau guard để bot vẫn xưng hô đúng.

## Kiểm chứng

- `pnpm test:ai` chạy 30 câu ResponseGuard → phải **0 số sai lọt ra**.
- Đổi prompt/model/KB/bảng giá → **chạy lại toàn bộ bộ test 200 câu**.
- `judge` chấm bộ test: đồng thuận với người ≥ 90%, nếu không → nâng lên tầng medium.
