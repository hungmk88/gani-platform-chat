# Đặc tả chính sách kênh — M1.3 (`channel_policies`, `window_state`, khóa ô gửi)

| | |
|---|---|
| Trạng thái | **ĐÃ DUYỆT 07/10/2026** (C1–C6). **Giá trị chính sách là "tạm, chờ anh xác nhận"** (§1); nghĩa của `api_closed` ở phía Zalo vẫn chờ tài liệu |
| Nguồn | Brief P3.2 mục 13; P8 (`channel_policies`, `conversations.window_state`); P9 (`channel_window_closed`, `POST …/messages`); Phụ lục v2.2 §13; danh sách tính năng B3; thông báo chính sách gửi tin của Zalo OA (xem `zalo-channel-spec.md` §7, Z-h, Z-i) |
| Liên quan | `zalo-channel-spec.md`, `inbound-spec.md`, `fsm-spec.md`, N100 |
| Ngày | 07/10/2026 |

**Cam kết:** chính sách gửi tin của kênh **không hard-code**: đọc từ bảng `channel_policies`, đổi khi nền tảng đổi chính sách mà không sửa mã; một tin sẽ bị nền tảng từ chối **không được gửi** (cả từ ô gửi của agent lẫn từ automation).

> **Điểm em suy ra, Brief không viết, cần duyệt:** §1 (cột bảng), §2 (hàm tính `window_state`, ánh xạ sang ba trạng thái, tính lại thay vì lưu), §3 (một cổng kiểm duy nhất). **Điểm chưa xác minh:** `api_closed` nghĩa là gì ở phía Zalo (§2).

## 1. `channel_policies` (Brief P8: không RLS, nền tảng quản trị, chỉ mục `(channel_type, effective_from)`)

Bảng toàn cục, **không có `org_id`**, cùng khuôn `feature_flags_global` (N74): `GRANT SELECT` cho `app_role` và `support_role`, ghi **chỉ bằng migration** (`migration_role`), không có `INSERT/UPDATE/DELETE` cho ứng dụng. Mỗi thay đổi chính sách là **dòng mới** với `effective_from` mới; **không sửa dòng cũ** (lịch sử giải thích được vì sao một tin cũ được/không được gửi).

| Cột | Ghi chú |
|---|---|
| `id` | UUIDv7 |
| `channel_type` | `zalo_oa` |
| `message_class` | `advisory` (tin tư vấn) · `transaction` (giao dịch) · `broadcast` (truyền thông) |
| `effective_from` | từ lúc nào áp dụng |
| `free_window_seconds` | khung miễn phí tính từ **tương tác cuối của người dùng** |
| `free_message_quota` | số tin miễn phí trong khung (đặt lại khi người dùng tương tác) |
| `unit_price_vnd` | giá mỗi tin ngoài khung/hạn mức |
| `outside_window_allowed` | gửi ngoài khung có được không (có tính phí) |
| `source_url`, `source_date`, `note` | nguồn và ghi chú ("tạm, chờ xác nhận") |

**Giá trị ban đầu (PR1 seed bằng migration): TẠM, chờ anh xác nhận.** Em không điền số theo trí nhớ: các số dưới đây lấy từ **thông báo chính thức của Zalo OA** (đăng 15/01/2024, hiệu lực 20/06/2023; đọc 07/10/2026): `advisory`: 48 giờ, 8 tin miễn phí, **55 đ**/tin ngoài khung hoặc quá hạn mức; `transaction`: **165 đ**/tin; `broadcast`: miễn phí theo gói dịch vụ. **Brief P22 không chứa các số này** (em đã kiểm; ghi lại để khỏi nhầm nguồn). Trang hướng dẫn "Tin Tư vấn" cùng nơi chỉ nêu khung 48 giờ và "giá theo bảng giá" nên có thể đã đổi; chủ đầu tư cung cấp giá trị chính thức (nếu khác: migration `effective_from` mới, không sửa dòng cũ). Dòng seed ghi `note = 'tạm, chờ xác nhận'`.

## 2. `window_state` (Brief P8, Phụ lục #13)

Giá trị: `open` · `paid_only` · `api_closed`. **Tính bằng hàm thuần** (không truy cập DB; nhận đầu vào, trả trạng thái và lý do):

```
windowState({ now, lastCustomerMessageAt, officialMessagesSinceCustomer, policy }) → { state, reason }
```

- `lastCustomerMessageAt`: thời điểm tin **gần nhất của khách** trong hội thoại (từ `messages`, `sender_kind='customer'`); chưa có tin khách nào → ngoài khung.
- `officialMessagesSinceCustomer`: số tin do OA gửi (agent/bot/system) **sau** tin khách gần nhất (để áp hạn mức "N tin miễn phí").
- **Ánh xạ đề xuất:** trong khung và còn hạn mức → `open`; ngoài khung hoặc hết hạn mức nhưng `outside_window_allowed` → `paid_only`; ngoài khung và không được gửi (`outside_window_allowed = false`) → `api_closed`. **`api_closed` ở phía Zalo nghĩa là gì chưa xác minh** (có thể là API từ chối hẳn); đặc tả chỉ định nghĩa theo chính sách trong bảng, và coi mọi lỗi "ngoài khung" Zalo trả về lúc gửi là `api_closed` cho tới khi biết (C1).
- **Không lưu làm nguồn sự thật:** cột `conversations.window_state` (Brief P8) nếu có chỉ là **bộ nhớ đệm để lọc danh sách**, có thể sai khi đồng hồ trôi; mọi quyết định gửi **tính lại từ dữ liệu gốc** (`lastCustomerMessageAt` và số tin) trong cùng transaction với việc gửi. Đề nghị M1.3 **chưa thêm cột** (Inbox cơ bản tính khi đọc); thêm khi cần lọc (C2).
- Khách nhắn tin mới → khung mở lại (`lastCustomerMessageAt` mới, hạn mức về 0) mà không cần ai cập nhật cột.

## 3. Khóa ô gửi và một cổng kiểm duy nhất

`ChannelPolicyService.check(conversation, now)` là **nơi duy nhất** quyết định được gửi hay không: nhận hội thoại, đọc chính sách còn hiệu lực lúc `now`, tính §2, trả `allowed` hoặc lỗi `channel_window_closed` (422, Brief P9). Ba người gọi, **cùng một hàm**: `POST /v1/conversations/{id}/messages` (agent), `OutboundService` (bot/automation), UI (đọc trạng thái để khóa ô). **Không có đường gửi vòng qua** (ESLint hạn chế import `ZaloAdapter` ngoài `OutboundService`; test quét như các cổng khác).

- UI khi `api_closed` (và `paid_only` chưa được cho phép): khóa ô gửi tin thường, hiện lựa chọn **ZNS (mẫu đã duyệt), gọi điện, tạo task** (Phụ lục #13). **M1.3 chỉ hiển thị lựa chọn, không gửi ZNS** (cần mẫu đã duyệt từ Zalo; Brief P22: "Mẫu ZNS và nhà cung cấp" quyết ở S11).
- Gửi `paid_only`: mặc định **chặn** cho tới khi có chính sách chi phí (ai được phép, cảnh báo trước khi gửi, ghi nhận); đề nghị M1.3 coi `paid_only` như bị khóa với agent (C3), vì chưa có cơ chế đối soát chi phí.
- Automation (S4+): gọi cùng `check`, không bắn tin sẽ bị từ chối (Phụ lục #13).
- Lỗi từ Zalo "ngoài khung" lúc gửi dù `check` cho qua (đồng hồ lệch, chính sách đổi): trả `channel_window_closed`, **không retry**, ghi `last_error` bằng mã.

## 4. Cập nhật chính sách

Không có màn hình trong M1.3. Cách đổi: PR migration thêm dòng `effective_from` mới (do chủ đầu tư cung cấp giá trị và nguồn), review như migration khác. Hàm đọc chính sách lấy dòng có `effective_from ≤ now` mới nhất theo `(channel_type, message_class)`; chính sách hiệu lực lúc nào của một tin cũ dùng `effective_from ≤ thời điểm tin`.

## 5. Câu hỏi mở

| # | Vấn đề | Đề xuất tạm | Cần |
|---|---|---|---|
| C1 | `api_closed` ở phía Zalo | **Đã chốt 07/10:** theo `outside_window_allowed`; lỗi ngoài khung = `api_closed` (nghĩa phía Zalo chờ tài liệu) | Tài liệu |
| C2 | Có lưu `conversations.window_state` không | **Đã chốt 07/10:** chưa; tính lại khi đọc/gửi | Xong |
| C3 | Gửi `paid_only` có được không | **Đã chốt 07/10:** chặn trong M1.3 | Xong |
| C4 | Giá trị chính sách chính thức | **Đã chốt 07/10:** seed tạm theo thông báo 15/01/2024; giá trị chính thức do chủ đầu tư cung cấp sau (migration `effective_from` mới) | **Anh** |
| C5 | Hạn mức "8 tin" tính cho tin của ai (bot, agent, hệ thống) | **Đã chốt 07/10:** mọi tin OA gửi sau tin khách gần nhất (đối chiếu khi có tài liệu) | Tài liệu |
| C6 | Hai OA khác gói dịch vụ có chính sách khác nhau | **Đã chốt 07/10:** chưa; chính sách theo `channel_type` | Xong |

## 6. Giới hạn thành thật

Số liệu chính sách có thể đã thay đổi sau thông báo 2024; hệ thống chỉ đúng chừng nào bảng `channel_policies` đúng. Hàm tính là xấp xỉ của quy tắc phía Zalo (không biết cách Zalo đếm "tương tác" và "tin"); Zalo vẫn là bên quyết định cuối: lỗi từ chối của nền tảng luôn thắng (§3). Chi phí ngoài khung không được đối soát trong M1.3.

## 7. Nghiệm thu

| # | Ca | Đạt khi |
|---|---|---|
| C-N1 | Trong khung, còn hạn mức | `open`; gửi được |
| C-N2 | Đúng 48 giờ (mép khung), tin khách mới | Biên đúng theo `free_window_seconds`; tin khách mới mở lại khung và đặt lại hạn mức |
| C-N3 | Hết hạn mức | Không còn `open`; theo `outside_window_allowed` |
| C-N4 | Ngoài khung | `POST …/messages` → 422 `channel_window_closed`; **0 tin** ghi, **0 lần** gọi adapter |
| C-N5 | Automation/bot ngoài khung | Không gọi adapter (cùng cổng) |
| C-N6 | Đổi chính sách (dòng mới) | Tin sau `effective_from` theo chính sách mới; tính lại cho tin cũ dùng chính sách cũ |
| C-N7 | `channel_policies` | `app_role` chỉ `SELECT`; `INSERT/UPDATE/DELETE` bị từ chối |
| C-N8 | Zalo từ chối "ngoài khung" dù `check` cho qua | 422, không retry, `last_error` là mã |
| C-N9 | Không có đường gửi vòng qua `check` | Test quét: `ZaloAdapter` chỉ được `OutboundService` dùng |

**Mutation:** bỏ `check` ở `POST …/messages` → N4 đỏ; hard-code 48 giờ → N6 đỏ; bỏ đặt lại hạn mức khi khách nhắn → N2 đỏ.
