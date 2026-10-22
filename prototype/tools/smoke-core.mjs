/* Smoke test prototype phần 1: 4 màn chính, khung app, 5 màn auth, trang hệ thống (Phụ lục C v3 dòng 0–9).
   Phần 2 (smoke-screens.mjs): các sửa lỗi sau đó, phần bổ sung theo Phụ lục C và màn sprint sau.
   Chạy: xem README.md. Thoát 0 khi mọi kiểm tra đạt. */
import { ROLES, createRunner } from './lib.mjs';

const { open, check, shot, renderAll, finish } = await createRunner();

const STATES = {
  'inbox.html': ['normal', 'loading', 'empty', 'error', 'aioff', 'api_closed', 'paid_only', 'send_failed', 'claimed', 'overload', 'after_hours', 'handover_invalid', 'handover_conflict'],
  'customer.html': ['normal', 'loading', 'empty', 'error', 'aioff', 'merge_suggestion', 'human_only', 'merge'],
  'leads.html': ['normal', 'loading', 'empty', 'error', 'aioff', 'many', 'saving', 'save_error', 'drawer', 'drawer_loading', 'drawer_error'],
  'bots.html': ['normal', 'loading', 'empty', 'error', 'aioff', 'config_error', 'missing_greeting', 'published_view'],
  'login.html': ['normal', 'loading', 'error', 'aioff'],
  'reset.html': ['normal', 'sent', 'set', 'weak', 'done', 'expired', 'aioff'],
  'invite.html': ['normal', 'signed_in', 'invalid', 'rate_limited', 'aioff'],
  'me.html': ['normal', 'tfa_on', 'loading', 'error', 'aioff'],
  'me.html?tab=security&x=1': ['normal', 'tfa_on'],
  'me.html?tab=notify&x=1': ['normal'],
  'system.html': ['403', '404', 'maintenance', 'error'],
  'twofa.html': ['normal', 'loading', 'wrong', 'locked', 'backup', 'enroll_required', 'reset_by_admin', 'aioff'],
};

await renderAll(STATES);
for (const sh of ['normal', 'disconnected', 'auto_offline', 'busy_30', 'switching', 'platform_session']) for (const r of ROLES) { const p = await open(`customer.html?shell=${sh}&role=${r}`); await p.close(); }
const idx = await open('index.html');
await shot(idx, 'index', true);
await idx.close();

// Hộp thư
let p = await open('inbox.html?role=sales');
check((await p.textContent('body')).includes("<script>alert('xss')</script>"), 'T2: chuỗi <script> hiện dạng chữ');
check((await p.locator('.messages img').count()) === 0, 'T2: không có thẻ <img> nào được tạo');
await p.keyboard.press('a');
await p.waitForTimeout(900);
check((await p.textContent('.conv-head')).includes('Nhân viên đang xử lý'), 'phím A nhận hội thoại');
await p.click('#composer');
await p.keyboard.type('a');
await p.waitForTimeout(100);
check((await p.textContent('.conv-head')).includes('Nhân viên đang xử lý'), 'gõ "a" trong ô soạn không kích hoạt phím tắt');
await p.fill('#composer', '');
await p.keyboard.type('/');
await p.waitForTimeout(100);
check((await p.locator('.template-list button').count()) === 3, '/ mở 3 mẫu trả lời nhanh');
await p.locator('.template-list button').first().click();
check((await p.inputValue('#composer')).startsWith('Chào Nguyễn Văn An'), 'mẫu điền biến tên khách');
await p.keyboard.press('Enter');
await p.waitForTimeout(1900);
check((await p.textContent('.messages')).includes('Đã xem'), 'tin gửi đi qua trạng thái tới "Đã xem"');
await shot(p, 'inbox');
await p.locator('body').click({ position: { x: 700, y: 120 } });
await p.keyboard.press('t');
await p.waitForTimeout(100);
check(await p.locator('.dialog').isVisible(), 'phím T mở hộp thoại Chuyển');
await shot(p, 'inbox-transfer-A');
await p.locator('.dialog .chip', { hasText: 'Trần Thu' }).click();
await p.waitForTimeout(900);
check((await p.textContent('.messages')).includes('Đã chuyển cho Trần Thu'), 'Chuyển A: 1 chip người nhận là chuyển xong');
await p.close();

p = await open('inbox.html?role=sales');
await p.keyboard.press('a');
await p.waitForTimeout(900);
await p.locator('body').click({ position: { x: 700, y: 120 } });
await p.keyboard.press('e');
await p.locator('.dialog button', { hasText: 'Đã xong' }).click();
await p.waitForTimeout(900);
check((await p.textContent('.dialog')).includes('Cập nhật lead?'), 'Đóng → nhắc cập nhật lead, không đổi lead');
await p.close();

p = await open('inbox.html?role=sales&state=api_closed');
check((await p.locator('.locked button').allTextContents()).join('|').includes('Gửi ZNS'), 'Hết khung Zalo: khóa ô gửi, hiện 3 lựa chọn');
check((await p.locator('#composer').count()) === 0, 'Hết khung Zalo: không có ô soạn tin thường');
await shot(p, 'inbox-api-closed');
await p.close();

p = await open('inbox.html?role=sales&state=claimed');
await p.click('#claim');
await p.waitForTimeout(900);
check((await p.textContent('.toast')).includes('Đã được Trần Thu nhận'), '409: "Đã được [tên] nhận"');
await p.close();

p = await open('inbox.html?role=manager&state=aioff');
check((await p.textContent('body')).includes('AI đang tắt'), 'AI tắt: Manager thấy dải báo');
check((await p.textContent('.handoff')).includes('Dữ liệu bot đã thu'), 'AI tắt: thẻ handoff dạng dữ liệu bot');
await shot(p, 'inbox-aioff');
await p.close();
p = await open('inbox.html?role=sales&state=aioff');
check(!(await p.textContent('body')).includes('AI đang tắt'), 'AI tắt: Sales không thấy dải báo');
await p.close();
p = await open('inbox.html?role=sales', { width: 1200, height: 800 });
check(!(await p.locator('.col-right').isVisible()), '< 1280px: cột phải thu lại');
await p.click('text=Hồ sơ khách');
check(await p.locator('.col-right').isVisible(), '< 1280px: mở ngăn kéo hồ sơ');
await p.close();

// Hồ sơ khách
p = await open('customer.html?role=marketing');
check((await p.textContent('body')).includes('090***0001'), 'Marketing thấy SĐT che');
check((await p.locator('.btn.primary').count()) === 0, 'Marketing: không có nút sửa');
await p.close();
p = await open('customer.html?role=manager&state=merge');
await shot(p, 'customer-merge');
await p.close();
p = await open('customer.html?role=sales');
await shot(p, 'customer');
await p.close();

// Pipeline
p = await open('leads.html?role=sales');
const mine = p.locator('.lead-card', { hasText: 'Hà Linh' }).first();
await mine.locator('select').selectOption('lost');
await p.locator('.dialog button', { hasText: 'Lưu' }).click();
check((await p.textContent('.dialog')).includes('Chọn một lý do'), 'Thua không lý do: bị chặn');
await p.locator('.dialog input[type=radio]').first().check();
await p.locator('.dialog button', { hasText: 'Lưu' }).click();
await p.waitForTimeout(1000);
check((await p.textContent('.toast')).includes('Đã đánh dấu Thua'), 'Thua có lý do: lưu sau khi máy chủ xác nhận');
check((await p.locator('.lead-card', { hasText: 'Trần Thu' }).first().getAttribute('data-movable')) === 'false', 'Sales không đổi bước lead của người khác');
await shot(p, 'leads-A');
await p.close();
p = await open('leads.html?role=sales&terminal=B');
await shot(p, 'leads-B');
await p.close();

// Bot
p = await open('bots.html?role=admin&state=missing_greeting');
await p.locator('.btn.primary', { hasText: 'Xuất bản' }).click();
check((await p.textContent('.dialog')).includes('câu chào bắt buộc'), 'Thiếu câu chào: chặn xuất bản');
await p.close();
p = await open('bots.html?role=admin');
await shot(p, 'bots');
await p.locator('.btn.primary', { hasText: 'Xuất bản' }).click();
await p.locator('.dialog .btn.primary').click();
await p.waitForTimeout(900);
check((await p.textContent('.toast')).includes('Đã xuất bản'), 'Xuất bản: chờ máy chủ rồi báo phiên bản mới');
await p.close();


// Khung app
p = await open('inbox.html?role=sales&shell=auto_offline');
check((await p.inputValue('#presence')) === 'offline', 'Tự Offline: bộ chọn ở Offline, không tự bật lại');
await p.locator('.banner button', { hasText: 'Bật Online' }).click();
check((await p.inputValue('#presence')) === 'online', 'Bật Online: người dùng tự bật lại');
await p.close();
p = await open('inbox.html?role=sales&shell=disconnected');
check((await p.textContent('.banner')).includes('Mất kết nối'), 'Mất kết nối realtime: có dải báo');
await shot(p, 'shell-disconnected');
await p.close();
p = await open('customer.html?role=platform_operator&shell=platform_session');
const navText = await p.textContent('.nav');
check(navText.includes('Platform') && !navText.includes('Hộp thư') && navText.includes('trong phiên'), 'Platform op: menu Platform + Khách hàng trong phiên, không có Hộp thư');
check((await p.textContent('.banner.error')).includes('Phiên truy cập dữ liệu'), 'Dải phiên truy cập platform');
check((await p.locator('#ws').count()) === 0 && (await p.locator('#presence').count()) === 0, 'Platform op: không có chọn workspace / trạng thái');
await shot(p, 'shell-platform');
await p.close();
p = await open('leads.html?role=marketing');
check((await p.locator('#presence').count()) === 0, 'Marketing: không có bộ chọn trạng thái agent');
await p.close();
p = await open('system.html?role=sales&state=error');
check((await p.textContent('.state-box')).includes('Mã:'), 'Lỗi chung: có mã tra cứu');
await shot(p, 'system-error');
await p.close();

// #1 Đăng nhập
p = await open('login.html?role=sales&state=error');
check((await p.textContent('[role=alert]')).includes('Email hoặc mật khẩu không đúng'), 'Lỗi chung, không nói sai cái nào');
check((await p.textContent('[role=alert]')).includes('tạm khóa 30 phút'), 'Khóa 30 phút: cùng câu lỗi chung (API không phân biệt)');
await shot(p, 'login-error');
await p.close();
p = await open('login.html?role=admin');
await p.fill('#pass', 'x');
await p.click('button[type=submit]');
await p.waitForURL(/twofa\.html\?role=admin/);
check((await p.textContent('h1')) === 'Xác thực 2 lớp', 'Admin đăng nhập → màn #2');
await p.close();

// #4 Nhận lời mời
p = await open('invite.html?role=sales');
await p.fill('#p1', 'ngan123');
await p.fill('#p2', 'ngan123');
await p.click('button[type=submit]');
check((await p.textContent('[role=alert]')).includes('ít nhất 12 ký tự'), 'Mật khẩu < 12 ký tự bị chặn');
await p.fill('#p1', 'abcdefghijklm');
await p.fill('#p2', 'abcdefghijklm');
await p.click('button[type=submit]');
check((await p.textContent('[role=alert]')).includes('có số'), 'Mật khẩu không có số bị chặn');
await p.fill('#p1', 'matkhau-dai-123');
await p.fill('#p2', 'matkhau-dai-123');
await p.click('button[type=submit]');
await p.waitForTimeout(900);
check((await p.textContent('.toast')).includes('Đã tham gia'), 'Mật khẩu hợp lệ → tham gia');
await p.close();
p = await open('invite.html?role=admin');
check((await p.textContent('main')).includes('bắt buộc xác thực 2 lớp'), 'Lời mời vai trò Admin: báo bước cài 2FA');
await shot(p, 'invite-admin');
await p.close();
p = await open('invite.html?role=sales&state=invalid');
check((await p.textContent('main')).includes('Link không hợp lệ hoặc đã hết hạn.') && (await p.locator('a.btn', { hasText: 'Đến trang đăng nhập' }).count()) === 1, 'Link không dùng được: một câu cho mọi lý do (N151)');
await p.close();
p = await open('invite.html?role=sales&state=signed_in');
check((await p.locator('#p1').count()) === 0 && (await p.locator('.btn.primary', { hasText: 'Tham gia' }).count()) === 1, 'Đã đăng nhập đúng email: chỉ bấm Tham gia, không đặt mật khẩu');
await p.close();

// #5 Hồ sơ cá nhân
p = await open('me.html?role=sales&tab=security');
check((await p.locator('button', { hasText: /Tắt/ }).count()) === 0, '2FA: không có nút tắt');
check((await p.locator('tr', { hasText: 'Phiên này' }).locator('button').count()) === 0, '"Phiên này" không có nút đăng xuất');
check((await p.locator('tbody button', { hasText: 'Đăng xuất' }).count()) === 2, '2 phiên khác có nút đăng xuất');
check(!/IP|thiết bị:/i.test(await p.textContent('tbody')), 'Phiên không có IP / thiết bị');
await p.locator('button', { hasText: 'Bật xác thực 2 lớp' }).click();
await shot(p, 'me-enroll-qr');
await p.fill('#totp', '12');
await p.click('button[type=submit]');
check((await p.textContent('[role=alert]')).includes('6 số'), 'Mã TOTP thiếu số bị chặn');
await p.fill('#totp', '123456');
await p.click('button[type=submit]');
await p.waitForTimeout(900);
check((await p.locator('.codes li').count()) === 10, '10 mã dự phòng');
check(await p.locator('button', { hasText: 'Xong' }).isDisabled(), '"Xong" khóa tới khi tick "Tôi đã lưu"');
await shot(p, 'me-codes');
await p.check('#saved');
await p.locator('button', { hasText: 'Xong' }).click();
check((await p.textContent('main')).includes('Đã bật') && (await p.locator('.codes').count()) === 0, 'Xong: 2FA đã bật, mã không hiện lại');
const firstOther = p.locator('tbody button', { hasText: 'Đăng xuất' }).first();
await firstOther.click();
await p.waitForTimeout(900);
check((await p.locator('tbody tr').count()) === 2, 'Đăng xuất 1 phiên khác');
await p.close();
p = await open('me.html?role=sales&tab=notify');
check((await p.locator('input[type=checkbox]:checked').count()) === 0, 'Thông báo mặc định tắt');
await p.close();
p = await open('me.html?role=sales');
await shot(p, 'me-info');
await p.close();

// #2 Xác thực 2 lớp
p = await open('twofa.html?role=admin');
await p.fill('#code', '12');
await p.click('button[type=submit]');
check((await p.textContent('[role=alert]')).includes('6 số'), '#2: mã thiếu số bị chặn');
await p.fill('#code', '123456');
await p.click('button[type=submit]');
await p.waitForTimeout(900);
check((await p.textContent('.toast')).includes('Xác thực xong'), '#2: mã đúng → vào hệ thống');
await p.close();
p = await open('twofa.html?role=admin&state=locked');
check(await p.locator('#code').isDisabled() && await p.locator('button[type=submit]').isDisabled(), '#2 khóa: ô mã và nút bị khóa');
check((await p.textContent('main')).includes('30 phút'), '#2 khóa: báo 30 phút');
await p.close();
p = await open('twofa.html?role=admin&state=wrong');
check((await p.textContent('[role=alert]')).includes('Mã không đúng'), '#2: mã sai');
await shot(p, 'twofa-wrong');
await p.close();
p = await open('twofa.html?role=admin');
await p.locator('button', { hasText: 'Dùng mã dự phòng' }).click();
await p.fill('#backup', 'k7m2-q9xp');
await p.click('button[type=submit]');
await p.waitForTimeout(900);
check((await p.textContent('.toast')).includes('Còn 9 mã'), '#2: mã dự phòng dùng được 1 lần');
await p.fill('#backup', 'k7m2-q9xp');
await p.click('button[type=submit]');
await p.waitForTimeout(900);
check((await p.textContent('[role=alert]')).includes('đã dùng'), '#2: dùng lại mã dự phòng bị từ chối');
await shot(p, 'twofa-backup');
await p.close();
p = await open('twofa.html?role=owner&state=enroll_required');
check((await p.locator('button', { hasText: 'Hủy' }).count()) === 0, '#2 cài bắt buộc: không có nút Hủy');
await p.fill('#totp', '123456');
await p.click('button[type=submit]');
await p.waitForTimeout(900);
check((await p.locator('.codes li').count()) === 10 && await p.locator('button', { hasText: 'Vào hệ thống' }).isDisabled(), '#2 cài bắt buộc: 10 mã, khóa tới khi tick');
await shot(p, 'twofa-enroll');
await p.check('#saved');
await p.locator('button', { hasText: 'Vào hệ thống' }).click();
check((await p.textContent('.toast')).includes('Đã bật'), '#2 cài bắt buộc: xong thì vào hệ thống');
await p.close();
p = await open('invite.html?role=admin');
await p.fill('#p1', 'matkhau-dai-123');
await p.fill('#p2', 'matkhau-dai-123');
await p.click('button[type=submit]');
await p.waitForURL(/state=enroll_required/);
check(true, 'Lời mời Admin → #2 cài 2FA bắt buộc');
await p.close();

await finish();
