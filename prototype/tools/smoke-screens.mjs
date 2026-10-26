/* global document */
/* Smoke test prototype phần 2: các sửa lỗi sau phần 1, phần bổ sung theo Phụ lục C (#3, #13, SLA tạm dừng, "Không áp dụng"),
   màn sprint sau (#7, #10, #11, #14, #15, #16, #19, #20, #21, #22, #23, #24, #25, #26, #27, #28, #29, #30) và bàn phím ở ngăn kéo.
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
  'autonomy.html': ['normal', 'loading', 'empty', 'error', 'aioff'],
  'members.html': ['normal', 'loading', 'empty', 'error', 'aioff', 'invite_expired'],
  'teams.html': ['normal', 'loading', 'empty', 'error', 'aioff'],
  'quick-replies.html': ['normal', 'loading', 'empty', 'error', 'save_error', 'aioff'],
  'customers.html': ['normal', 'loading', 'empty', 'error', 'aioff'],
  'ai.html': ['normal', 'loading', 'error', 'aioff', 'budget_80', 'budget_100', 'legal_ok'],
  'security.html': ['normal', 'loading', 'empty', 'error', 'aioff'],
  'privacy.html': ['normal', 'loading', 'empty', 'error', 'aioff'],
  'customer-import.html': ['normal', 'loading', 'empty_file', 'bad_file', 'error', 'aioff'],
  'customer-import.html?step=2&x=1': ['normal'],
  'customer-import.html?step=3&x=1': ['normal'],
  'customer-data.html': ['normal', 'loading', 'empty', 'error', 'save_error', 'aioff'],
  'customer-data.html?tab=tags&x=1': ['normal', 'empty', 'aioff'],
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
await p.getByRole('combobox', { name: 'Mức ưu tiên' }).selectOption('Khẩn');
check((await p.textContent('.toast')).includes('Đã đổi ưu tiên sang Khẩn'), 'Hộp thư: Manager đổi mức ưu tiên (C8, chờ API)');
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

// #20 Team
p = await open('teams.html?role=admin');
check((await p.locator('tbody tr').count()) === 3 && (await p.locator('.badge', { hasText: 'Mặc định' }).count()) === 1, '#20: 3 team, 1 mặc định');
await p.locator('.btn.primary', { hasText: 'Tạo team' }).click();
await p.locator('.dialog .btn.primary').click();
check((await p.textContent('.dialog [role=alert]')).includes('Nhập tên team'), '#20: tạo team cần tên');
await p.fill('#team-name', 'sales b2b');
await p.locator('.dialog .btn.primary').click();
check((await p.textContent('.dialog [role=alert]')).includes('đã có team tên này'), '#20: tên team không trùng');
await p.keyboard.press('Escape');
await p.getByRole('button', { name: 'Xóa Sales B2B' }).click();
check((await p.textContent('.dialog')).includes('team mặc định') && (await p.textContent('.dialog')).includes('chuyển kênh'), '#20: xóa team mặc định có kênh bị chặn, nêu 2 lý do');
await p.keyboard.press('Escape');
await p.getByRole('button', { name: 'Thành viên của Sales miền Nam' }).click();
check((await p.textContent('.dialog')).includes('cũng ở Sales B2B'), '#20: một người ở nhiều team');
await p.keyboard.press('Escape');
await shot(p, 'teams', true);
await p.close();
p = await open('teams.html?role=manager');
check((await p.locator('tbody tr').count()) === 1 && (await p.locator('.btn.primary').count()) === 0, '#20: Manager chỉ xem team của mình');
await p.close();
p = await open('teams.html?role=sales');
check((await p.textContent('main')).includes('không dùng Team'), '#20: Sales không có quyền');
await p.close();

// #22 Mẫu trả lời nhanh
p = await open('quick-replies.html?role=manager');
check((await p.locator('tbody tr').first().textContent()).includes('/chao-hoi'), '#22: sắp theo số lần dùng');
await p.fill('#qr-search', 'liên hệ');
await p.press('#qr-search', 'Enter');
check((await p.locator('tbody tr').count()) === 1, '#22: tìm theo tag');
await p.locator('.btn.primary', { hasText: 'Tạo mẫu' }).click();
await p.fill('#qr-key', 'Chào Hỏi');
await p.fill('#qr-text', 'x');
await p.locator('.dialog .btn.primary').click();
check((await p.textContent('.dialog [role=alert]')).includes('chữ thường không dấu'), '#22: tên ngắn đúng dạng');
await p.fill('#qr-key', 'chao-hoi');
await p.locator('.dialog .btn.primary').click();
check((await p.textContent('.dialog [role=alert]')).includes('Đã có mẫu /chao-hoi'), '#22: tên ngắn không trùng');
await p.fill('#qr-key', 'gui-lai');
await p.fill('#qr-text', 'Dạ {{ten_khach}}, gọi {{gia_ban}} ');
await p.locator('.dialog .btn.primary').click();
check((await p.textContent('.dialog [role=alert]')).includes('{{gia_ban}}'), '#22: biến lạ bị chặn');
await p.fill('#qr-text', 'Dạ ');
await p.locator('.dialog button', { hasText: 'SĐT công ty' }).click();
check((await p.textContent('.dialog .preview')).includes('SĐT công ty: người gửi điền') && (await p.inputValue('#qr-text')).includes('{{sdt_cong_ty}}'), '#22: chèn biến, xem trước có ô trống');
await p.locator('.dialog .btn.primary').click();
await p.waitForSelector('.toast');
check((await p.textContent('.toast')).includes('Dùng được ngay trong Hộp thư'), '#22: lưu mẫu');
await shot(p, 'quick-replies', true);
await p.close();
p = await open('quick-replies.html?role=admin&state=save_error');
await p.locator('.btn.primary', { hasText: 'Tạo mẫu' }).click();
await p.fill('#qr-key', 'moi');
await p.fill('#qr-text', 'Chào {{ten_khach}}');
await p.locator('.dialog .btn.primary').click();
await p.waitForSelector('.dialog .trace');
check((await p.textContent('.dialog [role=alert]')).includes('Không lưu được mẫu.'), '#22: lỗi khi lưu có mã và Thử lại');
await p.close();
p = await open('quick-replies.html?role=sales');
check((await p.textContent('main')).includes('không dùng Mẫu trả lời nhanh'), '#22: Sales không có quyền');
await p.close();

// #7 Danh sách khách
p = await open('customers.html?role=sales');
check((await p.locator('tbody tr').count()) === 5 && (await p.textContent('tbody')).includes('0900000001'), '#7: 5 khách, Sales thấy SĐT đầy đủ');
check((await p.locator('.btn.primary').count()) === 0 && (await p.locator('tbody input[type=checkbox]').count()) === 0, '#7: Sales không nhập, không gộp');
await p.fill('#f-q', '0004');
await p.press('#f-q', 'Enter');
check((await p.locator('tbody tr').count()) === 1 && (await p.textContent('tbody')).includes('Phạm Quốc Dũng'), '#7: tìm theo SĐT');
await p.fill('#f-q', 'chau');
await p.press('#f-q', 'Enter');
check((await p.locator('tbody tr').count()) === 1, '#7: tìm theo tên không dấu');
await p.locator('.btn.link', { hasText: 'Xóa bộ lọc' }).click();
await p.selectOption('#f-tag', 'Khách sỉ');
await p.selectOption('#f-range', '7');
check((await p.locator('tbody tr').count()) === 1, '#7: lọc 2 điều kiện (tag + liên hệ cuối)');
await p.selectOption('#f-owner', 'Lê Quân');
check((await p.textContent('main')).includes('Không có khách khớp bộ lọc'), '#7: không khớp bộ lọc');
await p.close();
p = await open('customers.html?role=manager&channel=SĐT');
check((await p.locator('tbody tr').count()) === 1 && (await p.textContent('tbody')).includes('Phạm Quốc Dũng'), '#7: lọc theo kênh');
await p.close();
p = await open('customers.html?role=manager');
await p.getByRole('checkbox', { name: 'Chọn Nguyễn Văn An' }).check();
check(await p.getByRole('button', { name: 'So sánh và gộp 2 khách' }).isDisabled(), '#7: gộp cần đúng 2 khách');
await p.getByRole('checkbox', { name: 'Chọn Trần Thị Bình' }).check();
check(!(await p.getByRole('button', { name: 'So sánh và gộp 2 khách' }).isDisabled()), '#7: chọn 2 khách thì gộp được');
await shot(p, 'customers', true);
await p.close();
p = await open('customers.html?role=marketing&state=aioff');
check(!(await p.textContent('tbody')).includes('0900000001') && (await p.textContent('tbody')).includes('090***0001') && !(await p.textContent('tbody')).includes('Hỏi giá'), '#7: Marketing thấy SĐT che; AI tắt ẩn tag AI');
await p.close();

// #26 AI nội bộ
p = await open('ai.html?role=owner');
check((await p.getByRole('button', { name: 'Chuyển sang Production…' }).isDisabled()) && (await p.textContent('#env-reason')).includes('Q1'), '#26: Production khóa khi chưa có văn bản pháp lý (Q1)');
check((await p.textContent('main')).includes('[PHONE_1]') && (await p.textContent('main')).includes('ai.customer_reply'), '#26: bảng che dữ liệu (E7), AI không trả lời khách');
await p.fill('#ai-budget', '0');
await p.locator('.btn.primary', { hasText: 'Lưu ngân sách' }).click();
check((await p.textContent('[role=alert]')).includes('lớn hơn 0'), '#26: ngân sách phải > 0');
await p.close();
p = await open('ai.html?role=owner&state=legal_ok');
await p.getByRole('button', { name: 'Chuyển sang Production…' }).click();
await p.locator('.dialog .btn.primary').click();
await p.waitForSelector('text=Đang chạy: Production');
check((await p.textContent('main')).includes('Đang chạy: Production'), '#26: Owner chuyển Production khi đã có văn bản');
await shot(p, 'ai', true);
await p.close();
p = await open('ai.html?role=admin&state=legal_ok');
check((await p.getByRole('button', { name: 'Chuyển sang Production…' }).isDisabled()) && (await p.textContent('#env-reason')).includes('Chỉ Owner'), '#26: Admin không chuyển Production');
await p.close();
p = await open('ai.html?role=owner&state=budget_100');
check((await p.textContent('main')).includes('ai_budget_exceeded') && (await p.textContent('main')).includes('Đã dùng 100%'), '#26: hết ngân sách thì dừng AI, về flow kịch bản');
await p.close();
p = await open('ai.html?role=owner&state=aioff');
check(!(await p.isChecked('#ai-e1')) && (await p.textContent('main')).includes('AI đang tắt'), '#26: AI tắt hiện dải báo, E1 tắt');
await p.close();
p = await open('ai.html?role=manager');
check((await p.textContent('main')).includes('không dùng AI nội bộ'), '#26: Manager không có quyền');
await p.close();

// #29 Sự cố bảo mật
p = await open('security.html?role=admin');
check((await p.locator('tbody tr').count()) === 2 && (await p.textContent('#sc-detail')).includes('SC-0003'), '#29: 2 sự cố, mở sẵn sự cố đang xử lý');
await p.locator('.page-head .btn.primary', { hasText: 'Mở sự cố' }).click();
await p.fill('#sc-title', 'Lộ danh sách, liên hệ 0912345678');
await p.locator('.dialog .btn.primary').click();
check((await p.textContent('.dialog [role=alert]')).includes('Bỏ SĐT, email'), '#29: chặn SĐT trong tóm tắt (quy tắc 5)');
await p.fill('#sc-title', 'Lộ file xuất khách lên nhóm chat chung');
await p.locator('.dialog .btn.primary').click();
await p.waitForSelector('.toast');
check((await p.textContent('.toast')).includes('Đã mở SC-0004'), '#29: mở sự cố');
await p.locator('.btn.primary', { hasText: 'Đóng sự cố…' }).click();
await p.fill('#sc-cause', 'Nguyên nhân đã rõ, đã khắc phục xong');
await p.locator('.dialog .btn.primary').click();
check((await p.textContent('.dialog [role=alert]')).includes('Hoàn tất các bước còn lại'), '#29: chưa xong các bước thì không đóng được');
await p.keyboard.press('Escape');
check((await p.locator('[role=group] a', { hasText: 'Thu hồi phiên' }).getAttribute('href')).startsWith('members.html'), '#29: thao tác nhanh dẫn tới Thành viên');
await shot(p, 'security', true);
await p.close();
p = await open('security.html?role=platform_operator&id=SC-0002');
check((await p.textContent('main')).includes('Platform operator') && (await p.locator('nav').textContent()).includes('Sự cố bảo mật') && (await p.locator('.btn.primary', { hasText: 'Đóng sự cố' }).count()) === 0, '#29: platform operator mở được; sự cố đã đóng chỉ xem');
await p.close();
p = await open('security.html?role=manager');
check((await p.textContent('main')).includes('không dùng Sự cố bảo mật'), '#29: Manager không có quyền');
await p.close();

// #11 Yêu cầu dữ liệu cá nhân
p = await open('privacy.html?role=admin');
check((await p.locator('tbody tr').count()) === 5 && (await p.locator('nav').textContent()).includes('Dữ liệu cá nhân'), '#11: 5 yêu cầu, mục menu cho Admin');
await p.locator('.btn.primary', { hasText: 'Ghi nhận yêu cầu' }).click();
await p.locator('.dialog .btn.primary').click();
check((await p.textContent('.dialog [role=alert]')).includes('Chọn khách'), '#11: ghi nhận cần khách');
await p.keyboard.press('Escape');
check((await p.getByRole('button', { name: 'Gửi OTP xác minh YC-0007' }).count()) === 1, '#11: yêu cầu chưa xác minh có bước OTP');
await p.selectOption('#pr-status', 'doing');
check((await p.locator('tbody tr').count()) === 2 && (await p.getByRole('button', { name: 'Tạo bản xuất YC-0006' }).count()) === 1, '#11: lọc trạng thái; yêu cầu xem có bản xuất');
await p.close();
p = await open('privacy.html?role=admin&status=doing');
await p.getByRole('button', { name: 'Xóa dữ liệu… YC-0003' }).click();
await p.fill('#erase-confirm', 'Pham Quoc Dung');
await p.locator('.dialog .btn.primary').click();
check((await p.textContent('.dialog [role=alert]')).includes('Tên chưa khớp') && (await p.textContent('.dialog')).includes('Không hoàn tác được'), '#11: xóa phải gõ đúng tên khách');
await shot(p, 'privacy', true);
await p.close();
p = await open('privacy.html?role=owner&status=doing');
check((await p.textContent('tbody')).includes('Trần Thị Bình'), '#11: Owner dùng được');
await p.close();
p = await open('privacy.html?role=manager');
check((await p.textContent('main')).includes('không dùng Yêu cầu dữ liệu cá nhân') && !(await p.locator('nav').textContent()).includes('Dữ liệu cá nhân'), '#11: Manager không có quyền, không có mục menu');
await p.close();

// #10 Nhập khách từ file
p = await open('customers.html?role=admin');
await p.locator('a.btn', { hasText: 'Nhập từ file' }).click();
await p.waitForSelector('[aria-current=step]');
check((await p.textContent('[aria-current=step]')).includes('Chọn file'), '#10: mở từ #7, bước 1');
await p.getByRole('button', { name: 'Dùng file ví dụ (prototype)' }).click();
check((await p.textContent('main')).includes('+84912345678') && (await p.textContent('main')).includes('SĐT không hợp lệ') && (await p.textContent('main')).includes('Trùng khách'), '#10: xem trước SĐT +84, dòng lỗi, dòng trùng');
await p.getByRole('combobox', { name: 'Nhập cột Email vào' }).selectOption('name');
await p.getByRole('button', { name: 'Tiếp tục' }).click();
check((await p.textContent('[role=alert]')).includes('Mỗi trường chỉ nhận từ một cột'), '#10: một trường chỉ ghép một cột');
await p.getByRole('combobox', { name: 'Nhập cột Email vào' }).selectOption('email');
await p.getByRole('radio', { name: 'Bỏ qua dòng trùng' }).check();
await p.getByRole('button', { name: 'Tiếp tục' }).click();
check((await p.textContent('main')).includes('18 — bỏ qua'), '#10: bước 3 theo lựa chọn khi trùng');
await p.getByRole('button', { name: 'Nhập 96 khách' }).click();
await p.waitForSelector('text=Đã nhập xong.');
check((await p.locator('a.btn', { hasText: 'Xem danh sách khách' }).count()) === 1, '#10: xong có lối về danh sách và file dòng lỗi');
await shot(p, 'customer-import', true);
await p.close();
p = await open('customer-import.html?role=admin&state=bad_file');
await p.getByRole('button', { name: 'Dùng file ví dụ (prototype)' }).click();
check((await p.textContent('[role=alert]')).includes('Không đọc được file') && (await p.textContent('[aria-current=step]')).includes('Chọn file'), '#10: file hỏng ở lại bước 1, có mã lỗi');
await p.close();
p = await open('customer-import.html?role=admin&state=empty_file');
await p.getByRole('button', { name: 'Dùng file ví dụ (prototype)' }).click();
check((await p.textContent('[role=alert]')).includes('không có khách nào') && (await p.textContent('[aria-current=step]')).includes('Chọn file'), '#10: file trống ở lại bước 1, có lối chọn file khác');
await p.close();
p = await open('customer-import.html?role=admin&state=error&step=3');
check((await p.textContent('[role=alert]')).includes('Chưa có khách nào được thêm') && (await p.locator('button', { hasText: 'Thử lại' }).count()) === 1, '#10: nhập lỗi có mã và Thử lại');
await p.close();
p = await open('customer-import.html?role=manager');
check((await p.textContent('main')).includes('không dùng Nhập khách từ file'), '#10: Manager không có quyền');
await p.close();

// #23 Dữ liệu khách
p = await open('customer-data.html?role=admin');
check((await p.locator('[role=tab]').count()) === 2 && (await p.locator('tbody tr').count()) === 4, '#23: 2 tab, 4 trường');
check((await p.locator('tbody tr', { hasText: 'Mã số thuế' }).textContent()).includes('Mã hóa, che'), '#23: trường nhạy cảm có nhãn');
check((await p.locator('tbody tr', { hasText: 'Mã số thuế' }).textContent()).includes('chỉ ẩn được') && (await p.getByRole('button', { name: 'Xóa Ngày mở cửa hàng' }).count()) === 1, '#23: trường có dữ liệu chỉ ẩn, trường trống xóa được');
await p.locator('.btn.primary', { hasText: 'Thêm trường' }).click();
await p.fill('#fd-name', 'Kiểu quán');
await p.selectOption('#fd-type', 'one');
await p.fill('#fd-options', 'Một');
await p.locator('.dialog .btn.primary').click();
check((await p.textContent('.dialog [role=alert]')).includes('ít nhất 2 lựa chọn'), '#23: kiểu chọn cần ≥ 2 lựa chọn');
await p.fill('#fd-name', 'mã so thue');
await p.locator('.dialog .btn.primary').click();
check((await p.textContent('.dialog [role=alert]')).includes('đã có trường tên này'), '#23: tên trường không trùng (bỏ dấu)');
await p.keyboard.press('Escape');
await p.locator('[role=tab]', { hasText: 'Tag' }).click();
await p.locator('.btn.primary', { hasText: 'Tạo tag' }).click();
await p.fill('#tag-name', 'Bò Viên');
await p.locator('.dialog .btn.primary').click();
check((await p.textContent('.dialog [role=alert]')).includes('trùng khi bỏ dấu'), '#23: tag trùng khi bỏ dấu bị chặn');
await p.keyboard.press('Escape');
await p.getByRole('button', { name: 'Gộp bo vien' }).click();
check((await p.inputValue('#merge-into')) === 'g2' && (await p.textContent('.dialog')).includes('14 khách mang "bo vien" chuyển sang "bò viên"'), '#23: gộp tag gợi ý tag giống, nêu số khách');
await p.keyboard.press('Escape');
await shot(p, 'customer-data', true);
await p.close();
p = await open('customer-data.html?role=manager&state=aioff');
check((await p.locator('[role=tab]').count()) === 1 && !(await p.textContent('tbody')).includes('Hỏi giá'), '#23: Manager chỉ tab Tag; AI tắt ẩn tag do AI gắn');
await p.close();
p = await open('customer-data.html?role=sales');
check((await p.textContent('main')).includes('không dùng Dữ liệu khách'), '#23: Sales không có quyền');
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
p = await open('autonomy.html?role=admin&state=empty');
check((await p.textContent('main')).includes('chưa có cờ nào') && (await p.locator('button', { hasText: 'Mở AI nội bộ' }).count()) === 1, '#27 Trống: một câu, một hành động');
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
