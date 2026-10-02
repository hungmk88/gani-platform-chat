# evals/ — Bộ chạy Test Specification cho AI

Nguồn chuẩn: Brief P6 (evals/ — dataset KHÔNG nằm trong repo), P11.1, P20 · Phụ lục v2.1 §11, v2.2 §19, v2.3 §25–27.

## Phạm vi — đặt đúng chỗ

| Việc | Nơi đặt | Ghi chú |
|---|---|---|
| `tenant-isolation.spec`, `workspace-isolation.spec` | `packages/testing` | Sinh từ OpenAPI, chạy **mọi PR**, chặn merge |
| `claim-race.spec`, FSM transition, outbox kill-test, chaos | `apps/api` / `apps/worker` + `packages/testing` | Theo P20 (Race, Chaos) |
| Runner Test Specification AI (đo chất lượng trả lời, ResponseGuard) | **`evals/`** (thư mục này) | Chỉ chứa **bộ chạy**, không chứa dữ liệu |

`evals/` không lặp lại test cách ly tenant hay FSM.

## Dữ liệu

- **Dataset (bộ 200 câu/workspace, 20% câu ẩn) KHÔNG nằm trong repo vendor** (Brief P6). Runner đọc dữ liệu từ nơi lưu do chủ đầu tư chỉ định (đường dẫn qua biến môi trường, tên biến ghi trong `.env.example`).
- Dữ liệu từ tin nhắn thật phải ẩn danh (tên, SĐT, địa chỉ, số liệu tài chính) trước khi vào bất kỳ repo nào (Phụ lục §19). Dữ liệu The Smile ẩn danh là bắt buộc. Pipeline ẩn danh nằm trong `evals/`, kèm bước quét PII trên dataset.
- Trong repo chỉ có dữ liệu giả sinh bằng factory (đủ cho test đơn vị của chính runner).

## Test Specification AI (Brief P20)

- 200 câu/workspace, chạy **3 lần/câu**, **3 lớp chấm**, 20% câu ẩn với vendor; chạy qua Batch.
- Thêm **30 câu số tự nhiên** cho ResponseGuard (P11.1): số tự nhiên (ngày, "2 sản phẩm"…) và số nghiệp vụ phải phân loại đúng 100%.
- Ngưỡng: theo Test Specification của chủ đầu tư (Brief P21 S12: ≥ 95%, **0 số sai** trên staging; S9: 30 câu số tự nhiên phân loại đúng 100%). Không đặt ngưỡng khác ở file này.
- Chạy khi: đổi prompt / model / KB / bảng giá; trước cổng go-live AI.
- Người chấm (judge): lớp chấm tự động dùng model lấy từ config tầng phù hợp, **không ghi cứng tên model** trong code hay tài liệu. Lớp chấm của người do chủ đầu tư/cố vấn thực hiện.

## PII masking (P8)

- Trước khi gửi provider AI, che: **họ tên cá nhân, ngày sinh**, SĐT, email, địa chỉ chi tiết, mã số thuế, số tài khoản, số giấy tờ → ô giữ chỗ dạng `[NAME_1]`, `[PHONE_1]`, `[TAX_ID_1]`. Ánh xạ ngược chỉ trong phiên.
- Test: các loại PII trên không còn trong nội dung gửi provider và không có trong log (chỉ `messageId`, `traceId`, `orgId`, `workspaceId`).
- Tên doanh nghiệp/quán và tên thương hiệu không che (cần cho báo giá B2B); phân biệt qua `customers.type` (`individual` · `business`). Cần bộ câu test riêng cho khách `business` có người liên hệ là cá nhân (xem `QUESTIONS.md`).

## Công cụ

- Vitest (cùng toàn monorepo, P20). **Không dùng Jest.**
- Lệnh chạy cụ thể do `package.json` của `evals/` định nghĩa khi có code; không ghi lệnh chưa tồn tại ở đây.

## Giám sát sau triển khai
Cảnh báo guard chặn / số sai lọt khách, ngưỡng tự hạ về "AI gợi ý – người gửi": theo Brief P19 và Phụ lục v2.3 §26.

## Cấm
- Đưa dataset test (200 câu, câu ẩn) vào repo.
- Gửi dữ liệu thật chưa ẩn danh cho vendor.
- Ghi cứng tên model hay nhà cung cấp.
- Tự đặt ngưỡng đạt khác Test Specification.
- Chạy bộ test AI trên dữ liệu production chưa ẩn danh.
