/* global document */
/* Smoke test prototype phần 2: các sửa lỗi sau phần 1, phần bổ sung theo Phụ lục C (#3, #13, SLA tạm dừng, "Không áp dụng"),
   màn sprint sau (#14, #15, #16, #19, #21, #24, #25, #27, #28, #30) và bàn phím ở ngăn kéo.
   Chạy: xem README.md. Thoát 0 khi mọi kiểm tra đạt. */
import { createRunner } from './lib.mjs';

const { open, check, shot, renderAll, finish } = await createRunner();
let p;

const STATES = {
  'channels.html': ['normal', 'loading', 'empty', 'error', 'aioff', 'token_expiring', 'disconnected'],
  'channels.html?screen=detail&x=1': ['normal', 'loading', 'empty', 'error', 'aioff', 'token_expiring', 'disconnected'],
  'tickets.html': ['normal', 'loading', 'empty', 'error', 'aioff', 'drawer', 'drawer_loading', 'drawer_error'],
  'audit.html': ['normal', 'loading', 'empty', 'error', 'aioff'],
  'audit.html?tab=access&x=1': ['normal'],
  'platform.html': ['normal', 'loading', 'empty', 'error', 'aioff'],
  'platform.html?tab=access&x=1': ['normal'],
  'platform.html?tab=policies&x=1': ['normal'],
  'overview.html': ['normal', 'loading', 'empty', 'error', 'aioff'],
  'autonomy.html': ['normal', 'loading', 'error', 'aioff'],
  'members.html': ['normal', 'loading', 'empty', 'error', 'aioff', 'invite_expired'],
  'workspace.html': ['normal', 'loading', 'error', 'aioff'],
  'workspace.html?tab=sla&x=1': ['normal'],
  'workspace.html?tab=allocation&x=1': ['normal'],
};

await renderAll(STATES);

// 3 lỗi đã sửa
p = await open('me.html?role=sales&tab=security');
await p.selectOption('.proto-bar select >> nth=0', 'tfa_on');
check((await p.textContent('main')).includes('Đã bật'), 'Sửa lỗi 1: đổi sang "2FA đã bật" thì #5 hiện Đã bật');
await p.close();
p = await open('inbox.html?role=sales');
await p.selectOption('.proto-bar select >> nth=2', 'busy_30');
check((await p.inputValue('#presence')) === 'busy', 'Sửa lỗi 2: khung Bận 30 phút → bộ chọn ở Bận');
await p.close();
for (const r of ['owner', 'admin', 'manager', 'marketing', 'viewer']) {
  p = await open(`system.html?role=${r}&state=403`);
  check((await p.getAttribute('.state-box a', 'href')) === `overview.html?role=${r}`, `Trang mặc định ${r}: Tổng quan`);
  await p.close();
}
p = await open('system.html?role=sales&state=404');
check((await p.getAttribute('.state-box a', 'href')) === 'inbox.html?role=sales', 'Sửa lỗi 3: Sales về Hộp thư');
await p.close();
p = await open('system.html?role=platform_operator&state=404');
check((await p.getAttribute('.state-box a', 'href')) === 'platform.html?role=platform_operator', 'Trang mặc định platform op: Platform');
await p.close();

// Phụ lục C: #13, SLA tạm dừng, #3, Không áp dụng
p = await open('leads.html?role=sales');
await p.locator('.lead-card', { hasText: 'Quán Phở Hà Nội' }).first().locator('.lead-open').click();
check(await p.locator('.lead-drawer').isVisible(), '#13: bấm tên lead mở drawer');
check((await p.locator('.lead-drawer ol li').count()) >= 1, '#13: có lịch sử');
check((await p.locator('.lead-drawer select').count()) === 1, '#13: Sales đổi bước lead của mình');
await shot(p, 'lead-drawer');
await p.keyboard.press('Escape');
check((await p.locator('.lead-drawer').count()) === 0, '#13: Esc đóng drawer');
await p.locator('.lead-card', { hasText: 'Nhà hàng Sen' }).first().locator('.lead-open').click();
check((await p.locator('.lead-drawer select').count()) === 0 && (await p.textContent('.lead-drawer')).includes('Chỉ người phụ trách'), '#13: Sales không đổi bước lead người khác');
await p.close();
p = await open('leads.html?role=support&state=drawer');
check((await p.locator('.lead-drawer select').count()) === 0 && (await p.textContent('.lead-drawer')).includes('chỉ xem'), '#13: Support chỉ xem');
await p.close();
p = await open('inbox.html?role=sales');
check((await p.textContent('.conv-list')).includes('SLA tạm dừng · chờ khách'), 'SLA tạm dừng khi chờ khách');
await p.close();
p = await open('inbox.html?role=sales&state=after_hours');
check((await p.textContent('.conv-list')).includes('SLA tạm dừng · ngoài giờ') && !(await p.textContent('.conv-list')).includes('Còn 12 phút'), 'SLA tạm dừng ngoài giờ');
await shot(p, 'inbox-after-hours');
await p.close();

// Chuyển / Gán lại theo #147 (U31)
p = await open('inbox.html?role=sales');
check(!(await p.textContent('.conv-list')).includes('Hoàng Yến'), '#147: Sales không thấy hội thoại đồng nghiệp đang giữ (N133)');
await p.close();
p = await open('inbox.html?role=sales&state=handover_invalid');
await p.locator('.conv', { hasText: 'Trần Thị Bình' }).click();
await p.keyboard.press('t');
await p.locator('.dialog .chip', { hasText: 'Vũ Nam' }).click();
await p.waitForTimeout(900);
check(await p.locator('.dialog').isVisible() && (await p.textContent('.dialog [role=alert]')).includes('Không chuyển được cho Vũ Nam'), '422: báo trong hộp thoại, hộp thoại vẫn mở');
check((await p.textContent('.dialog')).includes('Team CSKH (chờ U31)'), 'Chuyển cho team: nhãn chờ U31');
await p.close();
p = await open('inbox.html?role=sales&state=handover_conflict');
await p.locator('.conv', { hasText: 'Trần Thị Bình' }).click();
await p.keyboard.press('t');
await p.locator('.dialog .chip', { hasText: 'Vũ Nam' }).click();
await p.waitForTimeout(900);
check((await p.textContent('.toast')).includes('Hội thoại vừa thay đổi') && !(await p.textContent('.messages')).includes('Đã chuyển'), '409: báo tải lại, không chuyển');
await p.close();
p = await open('inbox.html?role=manager');
await p.locator('.conv', { hasText: 'Hoàng Yến' }).click();
await p.click('button:has-text("Gán lại")');
await p.locator('.dialog label', { hasText: 'Vũ Nam' }).click();
await p.click('.dialog button:has-text("Gán")');
await p.waitForTimeout(900);
check((await p.textContent('.messages')).includes('Đã gán cho Vũ Nam') && (await p.textContent('.conv-head')).includes('Phụ trách: Vũ Nam'), 'Manager gán lại hội thoại Trần Thu đang giữ');
await shot(p, 'inbox-assign');
await p.close();
p = await open('inbox.html?role=sales');
check((await p.locator('button:has-text("Gán cho")').count()) === 0, 'Sales không có nút Gán');
await p.close();
p = await open('reset.html?role=sales');
await p.fill('#email', 'khong-co@example.test');
await p.click('button[type=submit]');
await p.waitForTimeout(900);
const sentText = await p.textContent('[role=status]');
check(sentText.includes('Nếu email có trong hệ thống'), '#3: đã gửi, cùng một câu');
await p.close();
p = await open('reset.html?role=sales&state=set');
await p.fill('#p1', 'ngan');
await p.fill('#p2', 'ngan');
await p.click('button[type=submit]');
check((await p.textContent('[role=alert]')).includes('12 ký tự'), '#3: mật khẩu yếu bị chặn');
await p.fill('#p1', 'matkhau-moi-2026');
await p.fill('#p2', 'matkhau-moi-2026');
await p.click('button[type=submit]');
await p.waitForTimeout(900);
check((await p.textContent('h1')) === 'Đã đặt mật khẩu mới', '#3: đặt mật khẩu thành công');
await p.close();
p = await open('login.html?role=sales');
await p.click('text=Quên mật khẩu?');
await p.waitForURL(/reset\.html/);
check(true, '#1 → #3 qua link Quên mật khẩu');
await p.close();
for (const page of ['login.html?role=sales', 'twofa.html?role=admin', 'reset.html?role=sales', 'invite.html?role=sales']) {
  p = await open(`${page}&state=aioff`);
  check((await p.textContent('main')).includes('Không áp dụng AI'), `${page.split('?')[0]}: AI tắt — Không áp dụng`);
  await p.close();
}

// #19 Thành viên
p = await open('members.html?role=admin');
check((await p.locator('tbody tr').count()) === 6 && (await p.locator('.btn.primary').count()) === 1, '#19: 6 thành viên, 1 nút chính');
check((await p.locator('tbody tr', { hasText: 'Owner Gani' }).locator('button').count()) === 0, '#19: Admin không sửa được Owner');
await p.locator('.btn.primary', { hasText: 'Mời thành viên' }).click();
check(!(await p.locator('#inv-role option', { hasText: 'Owner' }).count()), '#19: Admin không mời được Owner');
await p.locator('.dialog .btn.primary').click();
check((await p.textContent('.dialog')).includes('Nhập email hợp lệ'), '#19: mời cần email hợp lệ');
await p.keyboard.press('Escape');
await p.locator('button', { hasText: 'Đặt lại 2FA…' }).first().click();
await p.locator('.dialog .btn.primary').click();
check((await p.textContent('.dialog')).includes('Ghi lý do'), '#19: đặt lại 2FA bắt buộc lý do');
await p.fill('#tfa-reason', 'Mất điện thoại, đã xác minh qua quản lý');
await p.locator('.dialog .btn.primary').click();
await p.waitForTimeout(900);
check((await p.textContent('.toast')).includes('thu hồi mọi phiên'), '#19: đặt lại 2FA chờ máy chủ, thu hồi phiên');
await shot(p, 'members', true);
await p.close();
p = await open('members.html?role=owner');
await p.locator('.btn.primary', { hasText: 'Mời thành viên' }).click();
check((await p.locator('#inv-role option', { hasText: 'Owner' }).count()) === 1, '#19: Owner mời được Owner');
await p.close();
p = await open('members.html?role=manager');
check((await p.textContent('main')).includes('không dùng Thành viên'), '#19: Manager không có quyền');
await p.close();

// #21 Workspace
p = await open('workspace.html?role=admin');
check((await p.locator('[role=tab]').count()) === 3 && (await p.locator('.btn.primary').count()) === 1, '#21: 3 tab, 1 nút chính');
await p.fill('#close-T2', '07:00');
await p.locator('.btn.primary', { hasText: 'Lưu' }).click();
check((await p.textContent('[role=alert]')).includes('T2: giờ đóng cửa phải sau giờ mở cửa'), '#21: giờ đóng phải sau giờ mở');
await p.locator('[role=tab]', { hasText: 'SLA' }).click();
check((await p.textContent('main')).includes('Chờ khách trả lời') && (await p.locator('#first-Khẩn').count()) === 1, '#21: tab SLA, 3 mức, quy tắc dừng đồng hồ');
await p.locator('[role=tab]', { hasText: 'Phân bổ' }).click();
await p.fill('#cap-default', '0');
await p.locator('.btn.primary', { hasText: 'Lưu' }).click();
check((await p.textContent('[role=alert]')).includes('từ 1 đến 50'), '#21: giới hạn tải 1–50');
await shot(p, 'workspace', true);
await p.close();
p = await open('workspace.html?role=manager&tab=sla');
check((await p.locator('.btn.primary').count()) === 0 && (await p.locator('#first-Thường').isDisabled()), '#21: Manager chỉ xem');
await p.close();
p = await open('workspace.html?role=sales');
check((await p.textContent('main')).includes('không dùng Cài đặt workspace'), '#21: Sales không có quyền');
await p.close();

// #24, #25
p = await open('channels.html?role=admin');
check((await p.locator('tbody tr').count()) === 2 && (await p.textContent('tbody')).includes('Đã kết nối'), '#24: danh sách 2 OA, trạng thái');
check((await p.locator('.btn.primary').count()) === 1, '#24: 1 nút chính');
await p.locator('tbody a', { hasText: 'Cấu hình' }).first().click();
await p.waitForURL(/screen=detail/);
check((await p.textContent('main')).includes('Webhook URL') && !(await p.textContent('main')).includes('access_token'), '#25: mở cấu hình, không hiện token');
await p.locator('button', { hasText: 'Làm mới token ngay' }).click();
await p.waitForTimeout(900);
check((await p.textContent('.toast')).includes('Đã làm mới token'), '#25: làm mới token chờ máy chủ');
await shot(p, 'channel-detail', true);
await p.close();
p = await open('channels.html?role=admin&screen=detail&state=disconnected');
check((await p.textContent('[role=alert]')).includes('Mất kết nối') && (await p.locator('button', { hasText: 'Làm mới token ngay' }).count()) === 0, '#25 mất kết nối: báo lỗi có mã, không có nút làm mới');
await p.close();
p = await open('channels.html?role=manager');
check((await p.textContent('main')).includes('không dùng Cài đặt kênh'), '#24: Manager không có quyền');
await p.close();
p = await open('channels.html?role=admin&screen=detail');
await p.locator('button', { hasText: 'Ngắt kết nối…' }).click();
check((await p.textContent('.dialog')).includes('Hội thoại cũ giữ nguyên'), '#25: ngắt kết nối hỏi xác nhận');
await p.close();

// #14, #15 Ticket
p = await open('tickets.html?role=support');
check((await p.locator('tbody tr').count()) === 4, '#14: mặc định ẩn ticket đã xong (4/5)');
check((await p.textContent('tbody')).includes('SLA tạm dừng · chờ khách') && (await p.textContent('tbody')).includes('Quá hạn 40 phút'), '#14: SLA tạm dừng và quá hạn');
await p.locator('label', { hasText: 'SLA' }).locator('select').selectOption('over');
check((await p.locator('tbody tr').count()) === 1, '#14: lọc Quá hạn');
await p.close();
p = await open('tickets.html?role=support');
await p.locator('.ticket-open', { hasText: 'Hỏi lại hồ sơ' }).click();
check(await p.locator('.lead-drawer').isVisible() && (await p.textContent('.lead-drawer')).includes('Khách hiện hữu'), '#15: drawer, nhận diện khách (I2)');
await p.locator('.lead-drawer button', { hasText: 'Nhận xử lý' }).click();
await p.waitForTimeout(900);
check((await p.textContent('.lead-drawer')).includes('Phụ trách (I3)') && (await p.locator('.lead-drawer select').count()) === 1, '#15: nhận xử lý rồi đổi trạng thái được');
await shot(p, 'ticket-drawer');
await p.keyboard.press('Escape');
check((await p.locator('.lead-drawer').count()) === 0, '#15: Esc đóng drawer');
await p.close();
p = await open('tickets.html?role=sales&state=drawer');
check((await p.locator('.lead-drawer select').count()) === 0 && (await p.textContent('.lead-drawer')).includes('chỉ tạo ticket'), '#15: Sales chỉ tạo, không xử lý');
await p.close();
p = await open('tickets.html?role=marketing');
check((await p.textContent('main')).includes('không dùng Ticket') && !(await p.textContent('.nav')).includes('Ticket'), '#14: Marketing không dùng, không có trong menu');
await p.close();
p = await open('tickets.html?role=viewer&state=drawer');
check((await p.locator('.lead-drawer').count()) === 0, '#15: Viewer không mở được drawer');
await p.close();

// #28, #30
p = await open('audit.html?role=admin');
check((await p.locator('tbody tr').count()) === 6 && !/09\d{8}|@/.test(await p.textContent('tbody')), '#28: thao tác quản trị, không có SĐT/email');
await p.locator('.tabs button', { hasText: 'Truy cập của platform' }).click();
check((await p.textContent('tbody')).includes('yêu cầu #128'), '#28: tab truy cập của platform có lý do');
await p.locator('.btn.primary', { hasText: 'Xuất nhật ký' }).click();
await p.waitForTimeout(900);
check((await p.textContent('.toast')).includes('xuất ở nền'), '#28: xuất nhật ký chạy nền');
await p.close();
p = await open('audit.html?role=manager');
check((await p.textContent('main')).includes('không dùng Audit log') && !(await p.textContent('.nav')).includes('Audit log'), '#28: Manager không có quyền, không có trong menu');
await p.close();
p = await open('platform.html?role=platform_operator');
check((await p.locator('tbody tr').count()) === 5 && (await p.textContent('tbody')).includes('Mất kết nối kênh'), '#30: sức khỏe 5 công ty');
await shot(p, 'platform-health');
await p.close();
p = await open('platform.html?role=platform_operator&tab=access');
await p.fill('#reason', 'ngắn');
await p.click('button[type=submit]');
check((await p.textContent('[role=alert]')).includes('ít nhất 10 ký tự'), '#30: phiên truy cập bắt buộc lý do');
await p.fill('#reason', 'Hỗ trợ lỗi kênh theo yêu cầu #140');
await p.click('button[type=submit]');
await p.waitForURL(/shell=platform_session/);
check((await p.textContent('.banner.error')).includes('Phiên truy cập dữ liệu'), '#30 → khung app: dải phiên truy cập');
await p.close();
p = await open('platform.html?role=platform_operator&tab=policies');
await p.locator('button', { hasText: 'Thêm phiên bản' }).click();
await p.locator('.dialog .btn.primary').click();
check((await p.textContent('.dialog')).includes('Chọn ngày hiệu lực'), '#30: chính sách mới bắt buộc ngày hiệu lực');
await p.close();
p = await open('platform.html?role=owner');
check((await p.textContent('main')).includes('không dùng Platform'), '#30: Owner không có quyền');
await p.close();

// #16, #27
p = await open('overview.html?role=manager');
check((await p.locator('.tile').count()) === 4 && (await p.textContent('main')).includes('Theo nhân viên'), '#16 Manager: 4 chỉ số + theo nhân viên');
await shot(p, 'overview');
await p.close();
p = await open('overview.html?role=sales');
check((await p.textContent('main')).includes('Hội thoại của tôi') && !(await p.textContent('main')).includes('Theo nhân viên'), '#16 Sales: chỉ số của mình');
await p.close();
p = await open('overview.html?role=manager&state=aioff');
check((await p.textContent('main')).includes('AI đang tắt'), '#16 AI tắt: Manager thấy dải báo');
await p.close();
p = await open('autonomy.html?role=owner');
check(await p.locator('button', { hasText: 'Nâng mức' }).isDisabled() && await p.locator('#f-ai\\.customer_reply').isDisabled(), '#27: Đợt 1 khóa nâng mức và ai.customer_reply');
await p.locator('#f-ai\\.internal').uncheck();
check((await p.textContent('.toast')).includes('Đã tắt ai.internal'), '#27: tắt cờ ai.internal');
await shot(p, 'autonomy', true);
await p.close();
p = await open('autonomy.html?role=manager');
check((await p.textContent('main')).includes('không dùng Tự chủ'), '#27: Manager không có quyền');
await p.close();

// Bàn phím: con trỏ vào ngăn kéo khi mở, trả về nút đã mở khi đóng
for (const [page, opener] of [['leads.html?role=sales', '.lead-open[data-opens="l0"]'], ['tickets.html?role=support', '.ticket-open[data-opens="t1"]']]) {
  p = await open(page);
  await p.locator(opener).focus();
  await p.keyboard.press('Enter');
  check(await p.evaluate(() => document.activeElement?.hasAttribute('data-drawer-close')), `${page.split('?')[0]}: mở ngăn kéo → con trỏ ở nút Đóng`);
  await p.keyboard.press('Escape');
  check(await p.evaluate((sel) => document.activeElement === document.querySelector(sel), opener), `${page.split('?')[0]}: Esc → con trỏ về nút đã mở`);
  await p.locator(opener).click();
  await p.locator('[data-drawer-close]').click();
  check(await p.evaluate((sel) => document.activeElement === document.querySelector(sel), opener), `${page.split('?')[0]}: bấm Đóng → con trỏ về nút đã mở`);
  await p.close();
}

await finish();
