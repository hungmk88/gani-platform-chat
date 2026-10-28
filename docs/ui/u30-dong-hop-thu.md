# [Gói 1 - Backend] U30 (phần 1): kênh, người phụ trách và đoạn trích trên dòng Hộp thư

**Gửi:** FE (Gói 2) · **Từ:** Backend (Gói 1) · **Ngày:** 28/10/2026 · **Căn cứ:** U30, N166, N169 trong `QUESTIONS.md`

Chào anh/chị,

`Conversation` (dùng chung cho danh sách `GET /v1/conversations`, chi tiết `GET /v1/conversations/{id}` và phản hồi của các hành động) có thêm ba trường, đã có trên `main` từ #367 (`apps/admin/src/api/schema.d.ts` sinh lại cùng PR đó).

## 1. Ba trường mới

| Trường               | Kiểu                                                                      | Lưu ý cho FE                                                                                                                                                                                   |
| -------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `channel`            | `{ id, type: 'zalo_oa' \| 'facebook' \| 'webchat', displayName } \| null` | **Có thể `null`** (lệch đề xuất của FE): hội thoại không đến từ kênh nào. Kênh đã bị xóa **vẫn hiện tên**, vì hội thoại đã diễn ra trên kênh đó                                                |
| `assignee`           | `{ id, name: string \| null } \| null`                                    | `null` khi chưa ai giữ (trùng `assignedUserId` = `null`). `name` có thể `null` (lệch đề xuất `string`): người đó không đặt tên, hoặc **không còn active** trong công ty. FE hiện nhãn thay thế |
| `lastMessagePreview` | `string \| null`                                                          | Xem mục 2                                                                                                                                                                                      |

`channelAccountId` (đã trả từ trước) nay cũng có trong OpenAPI.

## 2. `lastMessagePreview`

- **Là tin cuối bất kỳ**, của khách, agent hay bot, **trừ** sự kiện hệ thống. Khi agent vừa trả lời, dòng hiện câu trả lời đó. API không cho biết ai gửi tin cuối, nên FE không tự thêm tiền tố kiểu "Bạn:" được.
- **Tin text:**
  - đã chuẩn hóa (NFC);
  - xuống dòng và khoảng trắng liền nhau gộp thành một khoảng trắng;
  - cắt tối đa **120 ký tự hiển thị** (chữ có dấu, emoji ghép không bao giờ bị cắt đôi);
  - **không** có `…` ở cuối: FE tự hiển thị dấu cắt (ví dụ CSS `text-overflow: ellipsis`).
- **Tin không phải text** là chuỗi cố định: `[Hình ảnh]`, `[Tệp]`, `[Sticker]`, `[Lựa chọn]`.
- **`null`** khi hội thoại chưa có tin nào: lúc đó `lastMessageAt` cũng là `null`.
- **Là nội dung của khách:** FE không ghi log, không đưa vào analytics.

## 3. Hội thoại cũ

- Đoạn trích được ghi **khi có tin mới**.
- **Mốc thời gian:** hội thoại có tin từ trước deploy sẽ có `lastMessagePreview = null` cho tới khi script backfill chạy xong trên môi trường đó. FE không nên bật hiển thị preview trước khi ops xác nhận script đã chạy.
- Script: `pnpm --filter @gani/db backfill:last-message-preview` (ops chạy, xem trước bằng `--dry-run`; cách chạy ở `packages/db/CLAUDE.md`).
- #374 đã hiện đoạn trích khi có giá trị: trên môi trường chưa chạy script, hội thoại cũ hiện trống, không lỗi.
- FE có thể hiển thị placeholder (ví dụ "Chưa có tin nhắn" hoặc "Đang tải") cho trường hợp `null` **sau khi** ops xác nhận script đã chạy trên môi trường đó. Trước đó, để trống.
- Sau khi script chạy, hội thoại có tin (`lastMessageAt` khác `null`) đều có đoạn trích, **trừ** hội thoại chỉ có sự kiện hệ thống (hiện chưa phát sinh): vẫn `null`, FE hiện như hội thoại chưa có tin.

## 4. Chưa có trong phần này

- Bộ lọc `channelId` và `q` (tên hoặc SĐT khách): PR kế tiếp của U30.
- `unreadCount`, `tags`, `sla`: như N166, sau S1.

Trân trọng,
Backend (Gói 1)
