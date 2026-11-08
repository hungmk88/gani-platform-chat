# Lighthouse: widget và 5 trang admin (08/11/2026)

CEO brief 189, 190 (A), tầng 1. Báo cáo số đo, **không sửa code**.

> **Số đo trong container, khác máy thật và mạng thật.** Đây là số tham khảo, không phải số production. Khi có staging (S1,
> 23/11) chạy lại đúng cách dưới đây trên staging và so sánh; lệch nhiều thì báo CEO (brief 190 mục 11).

## 1. Cách đo

| Mục | Giá trị |
|---|---|
| Công cụ | Lighthouse 12.8.2 (cài tạm ngoài repo), Chromium 153 headless của Playwright, `--only-categories=performance` |
| Mobile (mặc định) | `formFactor: mobile`, 412×823, DPR 1,75; giả lập (`simulate`): RTT 150 ms, 1,6 Mbps, **CPU slowdown ×4** |
| Desktop (`--preset=desktop`) | 1350×940; RTT 40 ms, 10 Mbps, CPU ×1 |
| Máy | container cloud, `benchmarkIndex` 1993 |
| Lặp | 3 lần mỗi trang; bảng ghi **trung vị**, kèm khoảng điểm |
| Widget | `pnpm --filter @gani/widget build`, trang thử `apps/widget/demo/index.html?brand=a` qua `scripts/serve.mjs` (cổng 4173) |
| Admin | `main` `468b689`, `NODE_ENV=production pnpm build` + `next start` (cổng 3001) trên **API giả của E2E** (`e2e/stub-api.ts`, cổng 3000; chưa có staging); đăng nhập Admin, cookie phiên truyền bằng `--extra-headers` |

Mục tiêu: widget Performance mobile ≥ 90 (`apps/widget/CLAUDE.md`, brief 167); admin tải nội dung chính < 2,5 s (brief 166 mục 5,
đọc là LCP).

## 2. Kết quả

### Widget (mobile)

| Trang | Điểm | FCP | LCP | TBT | CLS | SI |
|---|---|---|---|---|---|---|
| Demo `?brand=a` | **100** (100–100) | 0,6 s | 0,8 s | 0 ms | 0 | 0,6 s |

**Đạt.** Lighthouse chỉ đo lúc tải trang: loader (2,19 KB gzip) chạy; bundle chính (8,68 KB) tải khi bấm nút hoặc 2 giây sau
`load`, nên chi phí của khung chat lúc mở **không** nằm trong số này.

### Admin, mobile (CPU ×4, mạng chậm giả lập)

| Trang | Điểm | FCP | LCP | TBT | CLS | LCP < 2,5 s |
|---|---|---|---|---|---|---|
| `/inbox` | 89 (87–90) | 1,8 s | **3,3 s** | 129 ms | 0,067 | Không |
| `/customers` | 95 (93–95) | 1,8 s | **2,7 s** | 92 ms | 0,015 | Không |
| `/bots` | 96 (95–99) | 1,8 s | **2,6 s** | 81 ms | 0,031 | Không (sát) |
| `/tickets` | 95 (92–97) | 1,8 s | **2,6 s** | 79 ms | 0,016 | Không (sát) |
| `/settings/workspace` | 93 (92–95) | 1,8 s | **3,1 s** | 81 ms | 0,022 | Không |

### Admin, desktop

| Trang | Điểm | FCP | LCP | TBT | CLS | LCP < 2,5 s |
|---|---|---|---|---|---|---|
| `/inbox` | 100 | 0,5 s | 0,7 s | 0 ms | 0,012 | Có |
| `/customers` | 100 | 0,5 s | 0,6 s | 0 ms | 0,007 | Có |
| `/bots` | 100 | 0,4 s | 0,6 s | 0 ms | 0,007 | Có |
| `/tickets` | 100 | 0,5 s | 0,6 s | 3 ms | 0,007 | Có |
| `/settings/workspace` | 100 | 0,5 s | 0,6 s | 0 ms | 0,011 | Có |

## 3. Vì sao mobile chậm (số của Lighthouse, mobile, lần 2)

| Trang | Phần tử LCP | TTFB | Render delay | JS tải về | Main thread |
|---|---|---|---|---|---|
| `/inbox` | "Chọn một hội thoại trong danh sách để xem." | 457 ms | **2833 ms** | 194 KiB | 1,9 s |
| `/customers` | dòng giới thiệu "Hồ sơ khách dùng chung…" | 457 ms | 2193 ms | 178 KiB | 1,5 s |
| `/bots` | dòng "Chỉ xem: không tạo, sửa…" | 453 ms | 2168 ms | 177 KiB | 1,4 s |
| `/tickets` | dòng "Công ty thử · Workspace thử" | 455 ms | 2174 ms | 181 KiB | 1,5 s |
| `/settings/workspace` | dòng "Công ty thử · Workspace thử" | 455 ms | 2177 ms | 183 KiB | 1,5 s |

- LCP là **một khối chữ**, không phải ảnh hay dữ liệu mạng: load delay và load time đều 0. Gần hết thời gian là **render delay**:
  chữ chỉ hiện sau khi JS phía client tải và chạy (×4 CPU làm thời gian này dài ra).
- Mỗi trang còn khoảng 25–28 KiB JS không dùng (Lighthouse "unused-javascript"), chủ yếu một chunk dùng chung.
- TTFB 0,46 s là của `next start` + API giả trong container; staging sẽ khác.

## 4. Đề xuất (chưa làm, chờ CEO duyệt)

1. **Chốt cấu hình đo cho mục tiêu admin < 2,5 s.** Admin là công cụ dùng trên máy tính: desktop đạt cả 5 trang (0,6–0,7 s);
   mobile giả lập không đạt cả 5 (2,6–3,3 s). Cần CEO chốt đo theo desktop, mobile hay cả hai; chốt xong thì ghi vào
   `QUESTIONS.md`.
2. Nếu phải đạt cả mobile: cho các khối chữ tĩnh trên (lời dẫn, tên công ty · workspace, chỗ trống "Chọn một hội thoại…") render
   từ server, không chờ JS client, để LCP về gần FCP (1,8 s). Bắt đầu từ `/inbox` (render delay 2,8 s).
3. Xem chunk dùng chung khoảng 25 KiB không dùng ở mọi trang bằng bộ phân tích bundle của Next, tách phần chỉ một màn cần.
4. Hộp thư: main thread 1,9 s ở ×4 CPU, cao nhất trong 5 trang; đo lại sau khi có dữ liệu thật (danh sách dài hơn API giả).
5. Widget: thêm một lần đo khi khung chat đang mở (cần kịch bản Lighthouse user-flow), sau khi có API widget (S10).
6. S1 (23/11): chạy lại mục 1 trên staging, cùng cấu hình; so với bảng trên, lệch nhiều thì báo CEO.
