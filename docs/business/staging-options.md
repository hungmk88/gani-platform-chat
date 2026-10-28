# Staging khi Q1/Q2 chưa có: so sánh 2 phương án

Bản nháp 30/10/2026 · Backend soạn · CEO quyết · Nguồn: Brief Backend & Core v1.0 (P5, P22, lịch S1 dòng 905, rủi ro dòng 1015), `infra/CLAUDE.md`, `QUESTIONS.md` (Q2, Q3, N35, N172)

## 1. Mục đích

So sánh 2 phương án dựng staging khi Q1 (pháp lý) và Q2 (cloud, vùng) chưa có kết quả, để CEO quyết ở mốc báo động 05/11/2026. Tài liệu chỉ trình bày dữ kiện kỹ thuật; Backend không chọn thay CEO.

## 2. Bối cảnh

- **S1 (16/11/2026), M1.1 Nền móng** có "Terraform staging"; điều kiện xong của S1 gồm "staging lên" (Brief dòng 905).
- **Brief có sẵn phương án dự phòng** ở cột rủi ro của S1: "Chờ chọn cloud → staging tạm, Terraform tách module".
- **Q2 chờ Q1** phần lưu trữ dữ liệu (Brief P22). Q1 hỏi: được gửi nội dung hội thoại (đã che PII) cho provider AI ở nước ngoài không.
- **Hạn CEO trả lời Q1/Q2: 10/11/2026**, mốc báo động 05/11/2026 (N172).
- **Staging chỉ chứa dữ liệu giả:** Brief cho phép seed hoặc dữ liệu ẩn danh, không dùng dữ liệu thật ở dev/staging (Brief P5, dòng 396). AI vẫn được viết và test ở staging với dữ liệu giả; chỉ việc bật ở production phụ thuộc Q1 (Brief dòng 982).
- **"Dữ liệu giả" trong tài liệu này = seed bịa hoàn toàn** (2 org giả, khách và sản phẩm do factory sinh), không có gì lấy từ dữ liệu thật. Dữ liệu thật đã ẩn danh là loại khác: nếu ẩn danh không đủ mạnh, vẫn có thể tái nhận dạng và vẫn là PII theo luật.

## 3. Hiện trạng hạ tầng trong repo (30/10/2026)

| Hạng mục | Có chưa | Ghi chú |
|---|---|---|
| Terraform (`infra/terraform/`, 8 module theo Brief P5) | **Chưa có file nào** | `infra/CLAUDE.md` và `QUESTIONS.md` Q2 ghi "Terraform chỉ chạy đến `validate`/`plan`", nhưng thực tế chưa có file `.tf` nào để chạy |
| Dockerfile cho `api`, `worker`, `admin` | **Chưa có** | Chỉ có `infra/docker/docker-compose.yml` cho dev (PostgreSQL 16 + pgvector, Valkey 8.0, Mailpit) |
| Bootstrap role DB | Có | `infra/db/bootstrap-roles.sql`, dùng ở dev và CI |
| CI | Có | 5 job: lint/typecheck/test, database (RLS), queue (kill-test), admin e2e, audit + secret scan |

**Hệ quả:** S1 không chỉ thiếu staging mà **chưa có hạ tầng as-code nào** (Terraform, Dockerfile). Dù chọn A hay B, phần lớn việc dựng staging chưa bắt đầu. Một phần **không phụ thuộc Q2** và làm được ngay (mục 6, mục 7 câu 5).

## 4. Hai phương án

### Phương án A: chờ Q1/Q2, dựng staging một lần trên cloud đã chọn

- Bắt đầu viết phần gắn nhà cung cấp của Terraform sau khi có Q2 (sớm nhất 10/11 nếu đúng hạn).
- Staging và production cùng cloud, cùng vùng, cùng module ngay từ đầu (đúng `infra/CLAUDE.md`: "staging giống production").
- Nếu Q2 có ngày 10/11: còn 6 ngày tới S1 (16/11) và 2 tuần của S1 (tới 29/11) để dựng staging. Nếu Q2 trễ hơn: điều kiện "staging lên" của S1 trượt theo.

### Phương án B: staging tạm (Brief dòng 905), Terraform tách module

- Dựng staging trên một nơi tạm do CEO chọn, chỉ chứa dữ liệu giả. Khi có Q2, viết lại phần gắn nhà cung cấp của các module rồi chuyển staging sang cloud chính thức.
- **Điều kiện bắt buộc** để B không vướng Q1:
  1. Staging **không bao giờ** chứa dữ liệu thật: chỉ seed bịa hoàn toàn (2 org giả theo Brief). Dữ liệu thật đã ẩn danh chỉ dùng khi luật sư đã xác nhận riêng. Không copy dữ liệu production.
  2. Không nối Zalo OA thật của Gani/The Smile vào staging (tin khách thật là PII); chỉ dùng OA thử nghiệm.
  3. Nơi tạm đáp ứng đủ yêu cầu kỹ thuật để staging còn giống production: PostgreSQL 16 có `vector`, `pg_trgm`, `unaccent`; tạo được role không owner, không BYPASSRLS; đổi được tham số log (`log_parameter_max_length = 0`, `docs/specs/rls-spec-M01.md` §3.7); Redis/Valkey có AOF; secret manager.
  4. CEO ghi rõ đây là ngoại lệ cho staging của quy tắc "không chốt dịch vụ của cloud cụ thể trước Q2" (`infra/CLAUDE.md`, mục Cấm).
- **Về PII masking và gửi dữ liệu ra nước ngoài:** với dữ liệu giả, staging không có PII thật để che hay để chuyển ra nước ngoài. `PiiMasker` vẫn chạy ở staging như production (Brief P11, bật từ Đợt 1) để test đúng đường code, không phải biện pháp pháp lý tạm.

## 5. So sánh

| Tiêu chí | A. Chờ Q1/Q2 | B. Staging tạm |
|---|---|---|
| Thời gian setup | Một lần, bắt đầu sau Q2. Chưa ước tính được số ngày vì chưa có Terraform/Dockerfile nào (mục 3); cần DevOps/lead BE ước tính | Bắt đầu ngay khi CEO chọn nơi tạm. Cùng khối lượng như A cho lần dựng đầu, cộng lần chuyển sau |
| Chi phí hạ tầng | Một môi trường staging: 1 VM 2 vCPU/4 GB + DB nhỏ (Brief P5). Giá phụ thuộc cloud, chưa có số | Như A trong thời gian tạm, cộng khoảng chồng lấn khi chuyển. Giá phụ thuộc nơi tạm, chưa có số |
| Công sức làm lại | Không | Viết lại phần resource gắn nhà cung cấp của các module (`network`, `compute`, `database`, `cache`, `storage`, `dns_tls`, `secrets`, `monitoring`); tạo lại secret, DNS. **Không** phải chuyển dữ liệu (staging chỉ có seed, tạo lại được) |
| Rủi ro pháp lý | Không phát sinh | Thấp nếu giữ đủ 4 điều kiện ở mục 4; cần luật sư xác nhận (mục 7, câu 2–3) |
| Rủi ro kỹ thuật | Thấp: staging và production cùng cloud | Staging tạm khác production (phiên bản, extension, tham số log): đúng rủi ro Brief dòng 1015. Giảm bằng điều kiện 3 và một script kiểm parity trước mỗi cổng |
| Khả năng chuyển sang A sau | Không cần | Được, nếu module tách lớp: biến và đầu ra chung, phần resource theo nhà cung cấp. Staging dựng lại từ seed |
| Tác động S1 | Đúng hạn nếu Q2 có trước hoặc ngay 10/11 và đủ người dựng trong S1. Trễ Q2 bao nhiêu thì "staging lên" trễ bấy nhiêu | Điều kiện "staging lên" của S1 không phụ thuộc Q2 |
| Tác động sau S1 | Chưa có staging thì không tính năng nào đạt Definition of Done (Brief dòng 891: "Demo trên staging"); pentest vòng 1 (05–16/01/2027) chạy trên bản build S4 cũng cần một môi trường | Các mục trên không phụ thuộc Q2 |
| Ghi chú về số | Số ngày và chi phí sẽ được ước tính sau khi có ít nhất 1 module Terraform mẫu và báo giá cloud từ CEO. Không đưa số bây giờ để tránh sai lệch. | Như cột A |

## 6. Đề xuất của Backend

Đây là quan điểm kỹ thuật để CEO có cơ sở, không phải quyết định.

- **Làm ngay phần không phụ thuộc Q2**, bất kể A hay B: Dockerfile multi-stage cho `api`, `worker`, `admin`; khung 8 module Terraform (biến, đầu ra, `envs/staging`, `envs/production`) chưa có resource; script kiểm parity (phiên bản PostgreSQL, extension, role DB, cờ mặc định). Phần này cần anh duyệt plan trước khi code.
- **Nếu 05/11 chưa có Q2: Backend nghiêng về B**, với đủ 4 điều kiện ở mục 4. Lý do: staging chỉ có dữ liệu giả nên Q1 không chặn về mặt kỹ thuật; điều kiện xong của S1 và các mốc demo/pentest sau đó không còn phụ thuộc Q2. Cái giá là viết lại phần resource của module khi chuyển. **Nhưng nếu CEO chọn B, cần luật sư trả lời câu 2 và câu 3 (mục 7) trước khi bật staging, không phải sau**: luật sư nói không được thì B không khả thi, phải quay lại A.
- **Nếu Q2 có trước 05/11: A**, vì không phải làm hai lần.

## 7. Câu hỏi cần quyết

| # | Câu hỏi | Ai trả lời | Cần trước |
|---|---|---|---|
| 1 | Đến 05/11 chưa có Q2 thì chọn A hay B? | CEO | 05/11/2026 |
| 2 | Staging đặt ở nơi tạm (có thể ở nước ngoài) và dùng seed data bịa hoàn toàn (không dùng dữ liệu thật đã ẩn danh), không có dữ liệu thật của khách hay nhân viên: có vướng gì không? | Luật sư | Trước khi bật staging theo B |
| 3 | Staging gọi provider AI ở nước ngoài với seed data bịa hoàn toàn (Brief dòng 982 cho phép test AI ở staging): có vướng gì không? | Luật sư | **Trước S2 (30/11/2026) nếu bật AI ở staging; trước S5 (11/01/2027) nếu chỉ bật AI ở production** |
| 4 | Nếu B: nơi tạm nào (theo tiêu chí ở mục 4, điều kiện 3), tài khoản đứng tên ai (Q3: Gani Foods), ngân sách tối đa | CEO | Khi chọn B |
| 5 | Cho Backend bắt đầu ngay phần không phụ thuộc Q2 (Dockerfile, khung Terraform; mục 6, ý 1)? Có người DevOps cho S1 chưa (Brief giao "Tech Lead, BE, DevOps")? | CEO | Sớm nhất có thể; ảnh hưởng cả A và B |
| 6 | Kết nối Zalo trên staging (S3) dùng OA thử nghiệm riêng, không dùng OA thật (liên quan Q6) | CEO | Trước S3 (14/12/2026) |

## 8. Cần sửa sau khi CEO quyết

- `infra/CLAUDE.md` và `QUESTIONS.md` Q2 đang ghi "Terraform chỉ chạy đến `validate`/`plan`": sửa cho đúng hiện trạng (chưa có Terraform), cùng PR với quyết định A/B.
- Quyết định A/B ghi vào `QUESTIONS.md` (Q2, N172).
- Cập nhật lại bản rà S1 (mục 9 trong danh sách việc trước S1): S1 thiếu Terraform, Dockerfile, staging - không chỉ thiếu staging.
