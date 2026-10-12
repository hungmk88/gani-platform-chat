# Code Review — Nhóm C: Xác thực (Better Auth, phiên, 2FA, bối cảnh tenant)

- **Mốc code:** `main` = `a443721`. PR4b-2a (`efce039`) ngoài mốc và không đụng module auth.
- **Ngày rà soát:** 12/10/2026. **Người rà soát:** Claude (chính tác giả phần lớn mã, xem mục "Giới hạn").
- **Phạm vi:** `apps/api/src/modules/auth/*`, `apps/api/src/modules/request-context/*`, `apps/api/src/app-setup.ts`, `apps/api/src/main.ts`, `packages/db/src/schema/{auth,sessions,accounts,verifications,two-factors}.ts`, các migration bảng auth (`users`, `sessions`, `accounts`, `verifications`, `two_factors`, trigger `users_status_transition_check`, `app.auth_user_id`, `app.memberships_for_user`), thư viện `better-auth@1.7.7`.
- **Cách tìm bằng chứng:** đọc mã và test; đọc mã nguồn thư viện đã cài (`node_modules`); chạy thật thư viện với bộ nhớ trong (kịch bản ở C-01).

## Tóm tắt

| Mức | Số | Mã |
|---|---|---|
| CRITICAL | 0 | — |
| HIGH | 1 | C-01 |
| MEDIUM | 0 | — |
| LOW | 2 | C-02, C-04 |
| INFO | 2 | C-03, C-05 |

**Điều cần anh quyết trước: C-01.** Bộ giới hạn tốc độ của Better Auth không biết địa chỉ IP thật của người gọi vì cấu hình không khai báo nguồn IP. Đo thật cho thấy: không có header → **mọi người dùng chung 10 lần đăng nhập mỗi phút**; có header `X-Forwarded-For` một giá trị → **người gọi tự chọn được IP, né hoàn toàn giới hạn**; chuỗi `a, b` (nginx/ALB nối thêm) → lại về xô chung. Không lộ dữ liệu, không bỏ qua mật khẩu hay 2FA, nên không xếp CRITICAL; nhưng với thang "lỗi bảo mật" anh dùng, đây là điểm sát nhất. Em để HIGH và nói rõ lý do; anh nâng mức nếu muốn.

---

## Phát hiện

### [HIGH] C-01 — Không khai báo nguồn IP cho bộ giới hạn tốc độ: xô chung toàn cục hoặc né giới hạn bằng header
- **File:** `apps/api/src/modules/auth/auth.config.ts:77-82` (khối `advanced` không có `ipAddress`), `:114-121` (`rateLimit`); thư viện `@better-auth/core/dist/utils/ip.mjs:196-219`, `better-auth/dist/api/rate-limiter/index.mjs:240-248`.
- **Nhóm:** C.
- **Mô tả:** Thư viện lấy IP từ `x-forwarded-for` (mặc định) và chỉ chấp nhận khi header có **đúng một** giá trị, trừ khi khai báo `trustedProxies`. Nếu không lấy được IP, nó **gộp mọi yêu cầu vào một xô theo đường dẫn** (`no-trusted-ip|/sign-in/email`). `auth.config.ts` không đặt `advanced.ipAddress.ipAddressHeaders` hay `trustedProxies`. Hệ quả ở môi trường sản xuất:
  1. Không có header (API nhận trực tiếp, hoặc proxy không thêm `X-Forwarded-For`): cả hệ thống chỉ đăng nhập được 10 lần/phút. Đầu ca làm việc của nhiều công ty là đủ để đóng cửa đăng nhập mà không cần kẻ tấn công.
  2. Proxy phổ biến nối thêm vào header người gọi gửi (`$proxy_add_x_forwarded_for`, ALB mặc định): kẻ tấn công gửi sẵn `X-Forwarded-For: 1.2.3.4` thì header thành `1.2.3.4, <IP thật>` → hai giá trị → xô chung. 11 yêu cầu mỗi phút của một người ngoài khóa đăng nhập của mọi tenant (từ chối dịch vụ không cần xác thực).
  3. Header một giá trị đi thẳng tới API (không qua proxy sạch): người gọi đổi giá trị mỗi lần → không bao giờ chạm giới hạn 10/phút (né giới hạn; khóa tài khoản 5 lần/30 phút vẫn chặn đoán mật khẩu trên **một** tài khoản, nhưng không chặn thử một mật khẩu phổ biến trên **nhiều** tài khoản).
  N79(10) đã ghi "header IP phải theo proxy khi triển khai" và "bộ nhớ tiến trình, chỉ đúng 1 instance"; **chưa ghi** hệ quả (1)–(3) và chưa có test. Phép thử lúc đó (`5 lần sai đều 401`) chạy ở chế độ phát triển, nơi thư viện tự gán `127.0.0.1` (`ip.mjs:217`) nên không lộ ra.
- **Bằng chứng:** chạy `better-auth@1.7.7` thật với bộ nhớ trong, `NODE_ENV=production`, cấu hình giới hạn y hệt `auth.config.ts:115-121` (mỗi kịch bản một tiến trình, 12 lần `POST /sign-in/email` sai mật khẩu):
  ```
  A  không có X-Forwarded-For (client 1)                 401 x10  429 429
  A2 client khác, cùng máy chủ, lần thứ 13               429
  B  X-Forwarded-For một giá trị, đổi mỗi lần           401 x12   (không bao giờ bị giới hạn)
  C  chuỗi "203.0.113.7, 10.0.0.1" (client 1)           401 x10  429 429
  C2 client khác, chuỗi khác, lần thứ 13                429
  D  một giá trị cố định                                401 x9   429 429 429   (đúng như thiết kế)
  ```
  Kịch bản (rút gọn, chạy được lại):
  ```js
  const auth = betterAuth({ baseURL, secret, database: memoryAdapter({ user: [], session: [], account: [], verification: [] }),
    emailAndPassword: { enabled: true },
    rateLimit: { enabled: true, storage: 'memory', window: 60, max: 100, customRules: { '/sign-in/email': { window: 60, max: 10 } } } });
  const hit = (h) => auth.handler(new Request(`${baseURL}/api/auth/sign-in/email`, { method: 'POST',
    headers: { 'content-type': 'application/json', origin: baseURL, ...h },
    body: JSON.stringify({ email: 'nobody@example.test', password: 'wrong-password-123' }) })).then((r) => r.status);
  ```
  `git grep -nE "ipAddressHeaders|trustedProxies|trust proxy" a443721 -- apps packages` → rỗng.
- **Đề xuất:** (không sửa trong PR docs) (1) chốt sơ đồ triển khai (có proxy nào, header nào đáng tin); (2) đặt `advanced.ipAddress.ipAddressHeaders` và `trustedProxies` theo đó, hoặc nếu chỉ có một proxy đáng tin thì cấu hình để proxy **ghi đè** header thay vì nối; (3) thêm test đơn vị trên `buildAuthOptions` kiểm bốn kịch bản A–D (chỉ cần `Request` giả, không cần DB); (4) kiểm lại điều kiện `S2 nhiều instance → Redis` trong N79(10) cùng lúc. Đây là việc cần Plan Mode riêng và quyết định hạ tầng của anh.
- **Mức độ:** HIGH

### [LOW] C-02 — `sessions.token` lưu giá trị thô; quyết định "kiểm ở 6c" của N77(6) chưa bao giờ được đóng
- **File:** `packages/db/src/schema/sessions.ts:7`; `QUESTIONS.md` N77 mục (6); thư viện `better-auth/dist/db/internal-adapter.mjs:273` và `:321-347`.
- **Nhóm:** C / B.
- **Mô tả:** N77 ghi "`sessions.token` có thể chứa hash hay token thô: chưa quyết, kiểm ở 6c". Các mục N79–N88 của 6c không nhắc lại. Thực tế Better Auth ghi `token: generateId(32)` thô và tra phiên theo đúng giá trị đó. Giảm nhẹ rõ ràng: cookie là giá trị **ký bằng HMAC với `BETTER_AUTH_SECRET`** (`cookies/index.mjs:172`), nên chỉ đọc được bảng `sessions` thì chưa dựng được cookie; chỉ `auth_role` có `SELECT` cột này (quét catalog); phiên sống tối đa 12 giờ (`session-hooks.ts:6`). Rủi ro còn lại: lộ đồng thời bản sao DB và bí mật ký. Đây là việc *đóng quyết định*, không phải lỗ hổng đang mở.
- **Bằng chứng:** `internal-adapter.mjs:273` (`token: generateId(32)`); `:347` (`field: "token"` trong `findSession`); `git grep -n "sessions.token\|token thô" a443721 -- QUESTIONS.md` chỉ ra dòng của N77.
- **Đề xuất:** ghi vào QUESTIONS một dòng "chấp nhận token thô vì cookie đã ký + 12 giờ + chỉ `auth_role` đọc" **hoặc** băm cột (cần bọc bộ chuyển đổi, đổi cả `revoking-adapter` và `switch-active-org`). Anh quyết. Cùng mức: giá trị `verifications.identifier` cũng thô (dùng cho cookie 2FA tạm thời), sống ngắn.
- **Mức độ:** LOW

### [INFO] C-03 — Khóa tài khoản theo email là đường để người ngoài khóa người khác
- **File:** `apps/api/src/modules/auth/login-lockout.ts:5-9, 23-27`.
- **Nhóm:** C.
- **Mô tả:** 5 lần sai liên tiếp → khóa tài khoản 30 phút, không xét nguồn. Ai biết một email đăng nhập đều khóa được người đó và lặp lại mỗi 30 phút. Đây là đánh đổi có chủ ý của N85 (bên kia là đoán mật khẩu), nên chỉ ghi nhận; nhưng với C-01 (né giới hạn IP) việc làm hàng loạt trở nên rẻ. Không có đường mở khóa do quản trị viên chủ động ở mốc này.
- **Bằng chứng:** `login-lockout.ts:23-27` (`WHERE email = lower(btrim($1))`, không có cột nguồn); `grep -rn "locked_until" apps/api/src` ngoài test: chỉ `login-lockout.ts`.
- **Đề xuất:** ghi "chấp nhận rủi ro khóa nhầm" vào N85 hoặc thêm một mục "đường mở khóa của Owner" vào lộ trình quản trị (PR7).
- **Mức độ:** INFO

### [LOW] C-04 — Tính nguyên tử của `switch-org` (thu hồi phiên cũ + tạo phiên mới) chưa có test thất bại giữa chừng
- **File:** `apps/api/src/modules/auth/switch-active-org.ts:46-61`; test `switch-active-org.test.ts`, `auth-flows.integration.test.ts:168-225`.
- **Nhóm:** C.
- **Mô tả:** Mã gọi `ctx.context.internalAdapter.createSession` bên trong `adapter.transaction(trx => ...)` mà **không** dùng `trx`. Nó vẫn nằm trong cùng transaction nhờ cơ chế `AsyncLocalStorage` của thư viện (`internal-adapter.mjs` dùng `getCurrentAdapter`), nên về mặt kỹ thuật đúng. Nhưng đó là hành vi nội bộ của thư viện, và comment ở dòng 9-10 ("both in one transaction") không có test nào ép buộc: các test hiện có kiểm đường thành công, hai yêu cầu song song, tổ chức không thuộc về người dùng; **không** có test "tạo phiên mới lỗi → phiên cũ vẫn còn hiệu lực". Nâng cấp thư viện có thể làm mất tính nguyên tử mà không test nào đỏ.
- **Bằng chứng:** danh sách `it(...)` của `switch-active-org.test.ts:95-141` và `auth-flows.integration.test.ts:168-225`; `internal-adapter.mjs:6,48,121` (`getCurrentAdapter`, `runWithTransaction`).
- **Đề xuất:** thêm một test: bơm lỗi vào `createSession` (ví dụ ràng buộc `sessions_lifetime_check` vi phạm bằng cách ép `expiresAt`) và kiểm phiên cũ vẫn `revoked_at IS NULL`. Gộp được vào lượt chạy lại test khi nâng phiên bản Better Auth (N87(3)).
- **Mức độ:** LOW

### [INFO] C-05 — Job dọn `verifications` có hạn; `sessions` hết hạn/đã thu hồi chưa có người dọn được nêu tên
- **File:** `apps/api/src/modules/auth/auth.config.ts:122-127`, `QUESTIONS.md` N87(2).
- **Nhóm:** C / B.
- **Mô tả:** `verification.disableCleanup: true` đúng vì `auth_role` không có `DELETE`. N87(2) ghi job dọn `verifications` bằng `migration_role` với hạn "go-live S1 + 1 tháng". Chưa thấy dòng nào nêu việc dọn `sessions` (phiên hết hạn hoặc đã thu hồi cũng giữ nguyên, vì xóa đã đổi thành `UPDATE revoked_at`).
- **Bằng chứng:** `git grep -nE "DELETE FROM (public\.)?(sessions|verifications)" a443721 -- apps packages infra` ngoài test: rỗng; N87(2) chỉ nêu `verifications`.
- **Đề xuất:** thêm `sessions` vào phạm vi job N87(2) (cùng khuôn với B-01: một job bảo trì).
- **Mức độ:** INFO

---

## Đã kiểm, không có phát hiện

| Mục | Cách kiểm | Kết quả |
|---|---|---|
| `org_id` không từ client | `git grep -nE "@(Body\|Query\|Param\|Headers)\(" a443721 -- apps/api/src` (bỏ test); đọc `tenant-context.middleware.ts:54-83`, `switch-active-org.ts:13-45` | rỗng; `orgId` chỉ từ `session.activeOrgId` hoặc duy nhất tổ chức có thật; `switch-org` kiểm thành viên `active` bằng hàm DB; trả cùng 404 cho "không phải thành viên" và "không tồn tại" |
| Cổng 2FA tại cửa, trước Better Auth | `two-factor.gate.ts:42-75`; test `two-factor.gate.test.ts` | quyết định trên đường dẫn đã chuẩn hóa, so sánh **bằng nhau tuyệt đối**; đường lạ đóng mặc định; lỗi đọc phiên → 503 (không cho qua) |
| Đường dẫn bị khóa | `auth.config.ts:25-40`, hook `:87-89` | đủ: `sign-up`, `verify-email`, `update-user`, `update-session`, `two-factor/disable`, `send-otp`, `verify-otp`, `reset-password`, `request-password-reset`, `reset-password/:token` (hook, chỉ qua HTTP) |
| Cookie phiên | `auth.config.ts:77-82` | `httpOnly`, `sameSite: lax`, `Secure` + tiền tố `__Secure-` theo `env.secureCookies`; `trustedOrigins` chỉ `baseURL` |
| Phiên | `auth.config.ts:67-76`, `session-hooks.ts` | 12 giờ, không gia hạn, `ipAddress`/`userAgent` bị xóa trước khi lưu (không lưu PII mạng) |
| Mật khẩu | `password.ts` | Argon2id (m=19456, t=2, p=1), 12–128 ký tự |
| Chống đếm tài khoản | `login-lockout.ts:41-48` | tài khoản bị khóa trả đúng lỗi "sai thông tin" và băm một lần để thời gian không phân biệt; email không tồn tại không đổi gì |
| Hai khóa tách biệt | test `auth-two-factor.integration.test.ts:154` | mật khẩu sai đếm ở `users`, mã sai đếm ở `two_factors`, mật khẩu đúng chỉ xóa khóa thứ nhất |
| 2FA "tin thiết bị" | `auth.config.ts:109` | `trustDeviceMaxAge: 0` (đã đo, xem chú thích `auth.config.ts:107-108`: nếu bỏ thì cookie bỏ qua yếu tố thứ hai 30 ngày) |
| Quyền DB của auth | quét catalog nhóm B | `auth_role` chỉ cột được liệt kê; không `DELETE`; cột mật khẩu/token/secret/backup chỉ `auth_role` |
| Tách pool/vai trò | `auth.module.ts`, `auth-db.ts`, `main.ts` | Better Auth dùng `DATABASE_URL_AUTH`; API nghiệp vụ dùng `DATABASE_URL_APP` |
| Bí mật & log | `grep -rn "console\." apps/api/src` (bỏ test); đọc `logger.*` ở `two-factor.gate.ts:66`, `tenant-context.middleware.ts` | không `console`; log chỉ mã lỗi (`errorCode`) và `traceId`, không email/mật khẩu/token |
| Phản hồi lỗi | `problem.ts:16-26` | RFC 9457; `detail` là câu cố định, không chép thông báo của driver |
| Bind mặc định | `main.ts:11,28` | `127.0.0.1` |

## Cần kiểm thêm (INFO, chưa chứng minh được)

1. **Quyền thực tế của `auth_role` trên PostgreSQL thật** (cột nào `UPDATE`/`SELECT` được) chỉ CI chứng minh (`auth-tables.spec`, `auth-schema.spec`); PGlite chạy bằng superuser. Dẫn tên test, không chạy lại.
2. **Hành vi đồng thời của `consumeOne`** (hai yêu cầu cùng tiêu thụ một mã 2FA/backup code, đúng một thắng) dựa vào test tích hợp song song ở CI; chưa chạy cục bộ. N87(4) đã đặt luật "đỏ thì dừng".
3. **Thứ tự hook của plugin 2FA và hook `after` của ta** (`auth.config.ts:94-100`): `succeeded()` phụ thuộc `ctx.context.newSession` còn đó khi plugin 2FA chen vào bước đăng nhập; test `auth-two-factor.integration.test.ts:154` bao phủ kết quả, nhưng thứ tự do thư viện quyết, cần chạy lại khi nâng phiên bản.

## Đề xuất ghi vào `QUESTIONS.md` (chưa ghi, anh quyết)

| Số đề xuất | Nội dung | Phát hiện |
|---|---|---|
| N112 | Nguồn IP cho giới hạn tốc độ: `advanced.ipAddress.*` theo sơ đồ triển khai, test bốn kịch bản A–D, cập nhật N79(10) | C-01 |
| N113 | Đóng N77(6): chấp nhận `sessions.token` thô (cookie ký, 12 giờ, chỉ `auth_role`) hoặc băm | C-02 |
| N114 | Test thất bại giữa chừng của `switch-org`; ghi "chấp nhận khóa nhầm" vào N85; mở rộng job dọn của N87(2) sang `sessions` | C-03, C-04, C-05 |

## Giới hạn

Rà soát bởi chính tác giả. Checklist cứng + bằng chứng chạy được. Không thay thế review độc lập.

- Không chạy được bộ test tích hợp `apps/api` (cần PostgreSQL và SWC; N42). Bằng chứng C-01 chạy thư viện thật nhưng với bộ nhớ trong, không qua `auth.config.ts` đầy đủ; kết luận về `ip.mjs`/`rate-limiter` được đọc từ mã nguồn thư viện đã cài ở `better-auth@1.7.7`.
- Mô hình đe dọa dựa vào hai giả định chưa có trong kho: sơ đồ triển khai (proxy nào đứng trước API) và việc API có nhận thẳng từ internet hay không. Nếu hạ tầng khác giả định, mức độ C-01 có thể đổi.
