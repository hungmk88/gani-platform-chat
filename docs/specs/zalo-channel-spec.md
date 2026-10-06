# Đặc tả kênh Zalo OA — M1.3 (tài khoản, bí mật, webhook, làm mới token, gửi)

| | |
|---|---|
| Trạng thái | **BẢN NHÁP, chờ duyệt** (07/10/2026). Nhiều sự thật về Zalo **chưa xác minh bằng tài liệu chính thức** (§7); phần phụ thuộc chúng không được viết mã cho tới khi xác minh |
| Nguồn | Brief P3.2 mục 7, 13, 14; P7 module 06; P8 nhóm M02 (`channel_accounts`); P9 (webhook vào, mã lỗi, endpoint); P10 F1 bước 1–2; P21 S3; P22 Q6; Phụ lục v2.2 §7, §14 |
| Liên quan | `channel-policy-spec.md`, `inbound-spec.md`, `outbox-spec.md` (khuôn hàm `SECURITY DEFINER`, thuê và thu hồi), `rls-spec-M01.md` §8, N38, N98, N100 |
| Ngày | 07/10/2026 |

**Cam kết:** một webhook đã được trả 200 thì sự kiện nằm trong `inbound_events` (bền, ở PostgreSQL) và không mất khi API hoặc worker chết; webhook giả hoặc sai kênh không ghi gì; bí mật của kênh không bao giờ ở dạng rõ trong DB, log hay phản hồi.

> **Điểm em suy ra, Brief không viết, cần duyệt:** §1 (cột, trạng thái kết nối), §2 (`SecretBox` thay KMS), §3 (hàm tra tenant, thứ tự bước, mã phản hồi, giới hạn), §4 (job làm mới token). **Điểm tài liệu Zalo chưa xác minh:** toàn bộ §7.

## 1. `channel_accounts` (Brief P8 M02)

Bảng nghiệp vụ, RLS theo org (**O**), xóa mềm, `UNIQUE(org_id, id)` cho khóa ngoại kép. Brief ghi chỉ mục `(org_id, workspace_id, type)` và `(type, external_account_id)` **unique**; em hiểu chỉ cái thứ hai là unique (một workspace có thể nối nhiều OA), nhắc để duyệt (Z1).

| Cột | Ghi chú |
|---|---|
| `id`, `org_id`, `workspace_id`, `created_at`, `updated_at`, `created_by`, `deleted_at` | cột chuẩn P8 |
| `type` | `zalo_oa` (đợt 1); `facebook`, `webchat` về sau |
| `external_account_id` | id OA do Zalo cấp |
| `display_name` | để hiển thị |
| `app_id` | id ứng dụng Zalo; **không phải bí mật** (nằm trong công thức chữ ký, §3) |
| `webhook_secret_enc`, `access_token_enc`, `refresh_token_enc` | **bản mã** (`bytea`), xem §2 |
| `key_version` | phiên bản khóa chủ đã mã hóa các cột trên |
| `access_token_expires_at`, `refresh_token_expires_at`, `last_refreshed_at` | thời điểm (UTC) |
| `refresh_claimed_at` | thuê dòng khi đang làm mới (§4) |
| `status` | `connected` · `token_expiring` · `disconnected` |
| `last_error` | **mã** (không thông điệp, không PII), như `outbox_events.last_error` |

**Câu hỏi Z2 (chặn):** khóa dùng để ký webhook là của **ứng dụng** hay của **từng OA**, và một ứng dụng nối nhiều OA ra sao. Đổi cột `webhook_secret_enc` (mỗi dòng hay mỗi `app_id`) và ràng buộc unique. Chờ tài liệu.

## 2. `SecretBox` (thay mã hóa envelope/KMS cho tới khi Q2 xong)

- AES-256-GCM, `node:crypto`; khóa chủ 32 byte từ biến môi trường `CHANNEL_SECRET_KEY_<version>` (không bao giờ vào repo, CI log, `.env.example` chỉ có tên biến).
- Bản mã = `nonce(12) ‖ tag(16) ‖ ciphertext`; **AAD = `channel_account_id` + tên cột**, để bản mã của cột này không dùng được ở cột khác hay dòng khác.
- `key_version` cho phép xoay khóa: đọc theo phiên bản ghi trên dòng, ghi lại bằng phiên bản mới nhất khi cập nhật token.
- Cấm log bản rõ, bản mã, khóa; lỗi giải mã trả mã (`E_SECRET_DECRYPT`), không thông điệp.
- **Lệch P8** ("envelope, KMS"): ghi ngoại lệ ở N100; nối KMS thật khi Q2 xong bằng cùng giao diện `SecretBox` (nguyên tắc: một nơi duy nhất mã hóa/giải mã).

## 3. Webhook vào (Brief P9: `POST /v1/hooks/zalo/{channelAccountId}`)

Thứ tự bước (mỗi bước lỗi dừng ngay, không ghi gì):

1. **Đọc thân thô** có giới hạn kích thước (đề xuất 256 KiB, cấu hình được), giữ nguyên byte (chữ ký tính trên thân thô, `bodyParser` của route này tắt).
2. **Tra tenant:** `app.channel_account_for_webhook(p_id uuid)` — `STABLE SECURITY DEFINER`, `search_path` cố định, `EXECUTE` cho `app_role` (không thêm role thứ 5; cùng khuôn `app.outbox_pending_orgs`, O1). Chỉ trả: `org_id`, `workspace_id`, `type`, `status`, `app_id`, `webhook_secret_enc`, `key_version` của dòng **chưa xóa mềm**; không trả token. Không tìm thấy hoặc `disconnected`/đã xóa: coi như kênh không tồn tại.
3. **Giải mã** `webhook_secret_enc` bằng `SecretBox` (tại API; DB không bao giờ thấy bản rõ).
4. **Kiểm chữ ký** (§7: công thức chưa xác minh chính thức): so sánh thời gian hằng số; dung sai timestamp cấu hình được (`WEBHOOK_TIMESTAMP_TOLERANCE_S`); thân bị sửa, header thiếu hay sai định dạng đều từ chối.
5. **Ghi** `inbound_events` trong `withTenant(org)`, `insertIfAbsent` theo `(channel_account_id, platform_message_id)` (`inbound-spec.md` §1).
6. **Trả 200** (kể cả sự kiện trùng: đã có thì vẫn 200, không ghi thêm).

**Phản hồi lỗi:** kênh không tồn tại, bị ngắt và chữ ký sai trả **cùng một** mã và thân (không lộ kênh có tồn tại); thân quá lớn 413; vượt giới hạn tốc độ 429 (`rate_limited`, Brief P9). Zalo xử lý phản hồi không-2xx ra sao (thử lại, tắt webhook?) **chưa xác minh** (Z3): trước khi chốt 401/404 cho chữ ký sai phải biết.
**Giới hạn tốc độ:** theo `channel_account_id`, thùng token trong bộ nhớ (stdlib), đề xuất 100 yêu cầu/giây, burst 200, cấu hình được. Hạn chế nói thẳng: mỗi bản API có thùng riêng, nhiều bản thì giới hạn thực nhân lên; chấp nhận đợt 1 (chống spam, không phải kiểm soát chi phí).
**Không log:** thân, chữ ký, bí mật, tên/PII của khách; chỉ `channelAccountId`, `platformMessageId`, `traceId`, mã lỗi.
**< 100 ms:** hai vòng DB (tra kênh, ghi sự kiện) + một phép băm. **Đo bằng test** (p95 trên PostgreSQL thật), không hứa; vượt thì tối ưu (bộ nhớ đệm bản mã vài giây là phương án, chưa dùng).

## 4. Làm mới token (`ChannelTokenRefreshJob`, Brief B2, Phụ lục #7)

- **Worker**, vòng thăm dò theo khuôn relay (tick, thuê, `SKIP LOCKED`): tìm `channel_accounts` còn `connected` có `access_token_expires_at − now < REFRESH_BEFORE_S` (cấu hình; thời hạn access token thật **chưa xác minh**, §7).
- **Thuê dòng** (`refresh_claimed_at`, quá hạn thuê thì thu hồi) để hai worker không làm mới cùng một kênh: refresh token có thể **chỉ dùng một lần** (§7), làm mới hai lần là hỏng.
- **Gọi Zalo ngoài transaction** (không giữ kết nối DB khi gọi mạng, timeout rõ), rồi **một `UPDATE` duy nhất** ghi bản mã mới (access + refresh + hạn + `key_version`) với điều kiện còn giữ thuê.
- **Chết giữa lúc Zalo đã trả lời và lúc ghi:** refresh token cũ đã bị tiêu thụ, token mới mất: kênh phải nối lại bằng tay. Không có cách tránh hoàn toàn; giảm cửa sổ bằng việc ghi ngay sau khi nhận và **ghi nhận trong "Giới hạn thành thật"**.
- Lỗi: thử lại có hạn với backoff; hết thử hoặc Zalo từ chối (token hỏng) → `status='disconnected'`, `last_error=<mã>`, **không retry mù**, cảnh báo.
- **Cảnh báo:** token (access hoặc refresh) còn < 24 giờ mà chưa làm mới được → `token_expiring` và cảnh báo trên bảng điều khiển vận hành; `disconnected` → cảnh báo khẩn. Ô gửi báo "kênh đang lỗi" (`channel_unavailable` 502, Brief P9), tin được giữ để gửi lại.

## 5. Gửi tin (`ZaloAdapter.send`, hợp đồng; chưa viết mã, phụ thuộc §7)

Vào: `OutboundMessageCommand` (Brief P9) đã qua kiểm khung (`channel-policy-spec.md`); ra: id tin của nền tảng hoặc lỗi có mã. Quy tắc: timeout rõ; lỗi mạng/5xx → thử lại có hạn; lỗi "ngoài khung" do Zalo từ chối → `channel_window_closed` 422 và cập nhật `window_state`; token hết hạn → làm mới một lần rồi thử lại; không gửi hai lần cùng `idempotencyKey` (kho Idempotency-Key tối thiểu thuộc PR gửi). **Nội dung API, mã lỗi cụ thể: chưa xác minh (Z6).**

## 6. Kiểm thử khi chưa có OA (Q6 chưa xong, N100)

Fixture payload và chữ ký **tính theo công thức đã ghi**, **stub Zalo** là máy chủ HTTP cục bộ trong test (cấp/làm mới token, nhận tin gửi, trả lỗi ngoài khung theo kịch bản); không bí mật thật trong repo/CI/log. Tiêu chí đóng S3 = **CI xanh + kiểm tay với OA test khi Q6 xong** (thông tin đăng nhập qua biến môi trường do anh nạp). Fixture phải được **đối chiếu lại với tài liệu chính thức** khi vendor có quyền truy cập Zalo; sai lệch → sửa fixture và đặc tả.

## 7. Bảng xác minh tài liệu Zalo

| # | Sự thật | Nguồn | Loại | Đã xác minh |
|---|---|---|---|---|
| Z-a | Chữ ký webhook: header `X-ZEvent-Signature` = `mac=` + `sha256(appId + thân JSON thô + timestamp + OASecretKey)`; **băm SHA-256 trên chuỗi nối, không phải HMAC** | Bài hỏi đáp trên `developers.zalo.me/community/detail/f62243c57f8096decf91` (chỉ thấy tiêu đề), mã của bên thứ ba (PR trên GitHub), tìm kiếm 07/10/2026 | Thứ cấp | **Chưa** |
| Z-b | Timestamp dùng trong công thức lấy từ đâu (header hay trường trong thân) | — | — | **Chưa** |
| Z-c | Làm mới token: `POST https://oauth.zaloapp.com/v4/oa/access_token`, `application/x-www-form-urlencoded`, header `secret_key`, thân `refresh_token`, `app_id`, `grant_type=refresh_token` | Bài của bên thứ ba (npm, GitHub), tìm kiếm 07/10/2026 | Thứ cấp | **Chưa** |
| Z-d | Access token **1 giờ**; refresh token **3 tháng, chỉ dùng một lần** | như trên | Thứ cấp | **Chưa** |
| Z-e | Tên loại sự kiện, payload tin văn bản/ảnh/file/follow, trường `message_id` | — | — | **Chưa** (không có nguồn) |
| Z-f | Chính sách thử lại và hành vi khi webhook trả không-2xx; thời hạn phản hồi | — | — | **Chưa** (Z3) |
| Z-g | API gửi tin tư vấn, lỗi khi ngoài khung, ZNS | — | — | **Chưa** (Z6) |
| Z-h | Khung 48 giờ, 8 tin miễn phí, 55 đ/165 đ (thông báo chính sách gửi tin) | `https://oa.zalo.me/home/resources/news/thong-bao-chinh-sach-gui-tin-va-quy-dinh-phi-gui-tin_1433049880779375099`, đăng 15/01/2024, hiệu lực 20/06/2023, đọc 07/10/2026 | **Chính thức** | Đã đọc; còn hiệu lực hay không **chưa** (đăng 2024) |
| Z-i | Trang hướng dẫn Tin Tư vấn: khung 48 giờ miễn phí, giá ngoài khung theo bảng giá `zalo.cloud/oa/pricing`; **không nêu 8 tin** | `https://oa.zalo.me/home/documents/guides/tin-tu-van`, đọc 07/10/2026 | **Chính thức** | Đã đọc; lệch nhẹ so với Z-h (xem `channel-policy-spec.md`) |

`developers.zalo.me` là trang dựng bằng JavaScript: công cụ đọc của em chỉ thấy tiêu đề. **Các dòng "Chưa" là chặn:** PR nào dựa vào chúng (kiểm chữ ký, chuẩn hóa tin, làm mới token, gửi tin) viết **sau** khi vendor có quyền truy cập Zalo (Q6) và đối chiếu; trước đó chỉ làm phần không phụ thuộc (khung bảng, `SecretBox`, kho `inbound_events`, bộ xử lý trên payload chuẩn hóa trừu tượng).

## 8. Câu hỏi mở

| # | Vấn đề | Đề xuất tạm | Cần |
|---|---|---|---|
| Z1 | Chỉ mục `(org_id, workspace_id, type)` có unique không | Không unique (một workspace nhiều OA) | Anh |
| Z2 | Khóa webhook theo ứng dụng hay theo OA | Chờ tài liệu | Q6 / tài liệu |
| Z3 | Zalo xử lý phản hồi không-2xx ra sao | Trả cùng một mã cho sai chữ ký và kênh lạ | Tài liệu |
| Z4 | Ngưỡng làm mới token và thuê | Cấu hình; số theo thời hạn thật | Tài liệu |
| Z5 | Nối KMS thật | Khi Q2 xong, cùng giao diện `SecretBox` | Q2 |
| Z6 | API gửi tin, mã lỗi, ZNS | Chờ tài liệu; PR gửi chờ | Q6 / tài liệu |
| Z7 | Giới hạn tốc độ chia sẻ giữa nhiều bản API | Đợt 1 trong bộ nhớ; đo rồi mới chuyển sang Valkey | Sau đo tải |

## 9. Giới hạn thành thật

Chữ ký webhook ở đây là **băm có khóa nối chuỗi**, không có tính chất của HMAC (nếu đúng như nguồn thứ cấp nói); độ an toàn dựa vào bí mật và việc so sánh thời gian hằng số, và không có cách chống phát lại ngoài dung sai timestamp (chống trùng thật nằm ở `UNIQUE` của `inbound_events`). Khóa chủ trong biến môi trường **không bằng** KMS (lộ biến môi trường là lộ mọi bí mật kênh). Refresh token dùng một lần: có cửa sổ nhỏ mất token khi chết giữa chừng. `< 100 ms` là mục tiêu đo, không phải cam kết.

## 10. Nghiệm thu

| # | Ca | Đạt khi |
|---|---|---|
| Z-N1 | Chữ ký đúng (fixture) | 200, đúng một dòng `inbound_events` |
| Z-N2 | Chữ ký sai, thân bị sửa, header thiếu, timestamp lệch | Từ chối cùng một mã; **0 dòng** ghi |
| Z-N3 | Kênh không tồn tại / bị xóa mềm / `disconnected` | Cùng mã với chữ ký sai; không lộ tồn tại |
| Z-N4 | Gửi cùng sự kiện hai lần | Cả hai 200; một dòng |
| Z-N5 | Hàm tra webhook | Chỉ trả đúng cột đã khai; `app_role` không đọc `channel_accounts` khi chưa đặt tenant (`TN001`) |
| Z-N6 | Cô lập | Org A không đọc/ghi kênh của org B (RLS) |
| Z-N7 | `SecretBox` | Vòng mã hóa; sai khóa; bản mã đổi chỗ cột khác → lỗi; xoay `key_version` |
| Z-N8 | Làm mới token (stub) | Token hết hạn giả lập → tự làm mới, không mất tin; hai worker không làm mới cùng lúc |
| Z-N9 | Refresh bị từ chối | `disconnected`, cảnh báo, không retry mù |
| Z-N10 | Đo độ trễ | p95 ghi nhận trong báo cáo CI (không là điều kiện đạt) |

**Mutation:** bỏ kiểm chữ ký → N2 đỏ; bỏ `UNIQUE` → N4 đỏ; không thuê dòng → N8 đỏ.
