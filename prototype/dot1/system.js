/* global Proto */
/* 4 trang hệ thống (Phụ lục C v3 dòng 0): 403, 404, Bảo trì, Lỗi chung. Mỗi trang 1 câu + 1 hành động. */
const { h } = Proto;

const PAGES = {
  403: ['Bạn không có quyền xem trang này.', 'Vai trò của bạn không dùng màn này. Nếu cần, nhờ Admin cấp quyền.', 'Về trang chính'],
  404: ['Không tìm thấy trang.', 'Trang không tồn tại hoặc thuộc công ty khác.', 'Về trang chính'],
  maintenance: ['Hệ thống đang bảo trì.', 'Dự kiến xong lúc 22:30 hôm nay. Tin khách gửi tới vẫn được lưu.', 'Tải lại'],
  error: ['Đã có lỗi.', 'Không phải do bạn. Thử lại sau ít phút; nếu còn lỗi, gửi mã bên dưới cho Admin.', 'Thử lại'],
};

Proto.mount({
  page: 'system',
  states: [['403', '403 — Không có quyền'], ['404', '404 — Không tìm thấy'], ['maintenance', 'Bảo trì'], ['error', 'Lỗi chung']],
  render: () => {
    const [title, text, action] = PAGES[Proto.get('state', '403')] || PAGES[403];
    return h('div', { class: 'page-body' }, h('div', { class: 'state-box', role: Proto.get('state', '403') === 'error' ? 'alert' : null },
      h('h1', {}, title),
      h('p', { class: 'muted' }, text),
      Proto.get('state', '403') === 'error' ? h('p', { class: 'trace muted' }, 'Mã: 7f3a9c1e-…') : null,
      h('a', { class: 'btn primary', href: `inbox.html?role=${Proto.role()}` }, action)));
  },
});
