/* global Proto */
/* #16 Tổng quan (danh-sach-man-M11; A7, P4). Sprint S5, nộp wireframe 04/01/2027. Trang mặc định của Owner, Admin,
   Manager, Marketing, Viewer (apps/admin/CLAUDE.md). Phụ lục B: Sales, Support chỉ thấy số của mình.
   Mọi con số là số liệu mẫu; danh sách chỉ số Đợt 1 và nguồn dữ liệu chờ Backend (U29). */
const { h } = Proto;

function own() {
  return ['sales', 'support'].includes(Proto.role());
}

function tile(label, value, note, cls) {
  return h('div', { class: 'card stack tile' }, h('span', { class: 'small muted' }, label), h('strong', { class: `tile-value ${cls || ''}` }, value), note ? h('span', { class: 'small muted' }, note) : null);
}

function tiles() {
  if (own()) {
    return [
      tile('Hội thoại của tôi hôm nay', '14', 'Đang xử lý 3 · Chờ khách 2'),
      tile('Thời gian phản hồi đầu (TB)', '3 phút 40 giây', 'Hôm nay'),
      tile('Quá hạn SLA của tôi', '1', 'Cần xử lý ngay', 'error'),
      tile(Proto.role() === 'sales' ? 'Lead mới của tôi' : 'Ticket đang mở của tôi', Proto.role() === 'sales' ? '4' : '6', '7 ngày gần nhất'),
    ];
  }
  return [
    tile('Hội thoại hôm nay', '126', 'Bot xử lý 71 · Người 55'),
    tile('Chờ nhân viên nhận', '5', 'Lâu nhất 12 phút', 'warn'),
    tile('Quá hạn SLA', '3', 'Hôm nay', 'error'),
    tile('Bot tự giải quyết', '38%', 'Định nghĩa: Phụ lục kỹ thuật mục 27 (không hỏi lại trong 72 giờ)'),
  ];
}

function systemStatus() {
  // P4: giám sát lỗi, uptime, cảnh báo sự cố — chỉ trạng thái, không chi tiết kỹ thuật.
  return h('section', { class: 'card stack' },
    h('h2', {}, 'Tình trạng hệ thống (P4)'),
    h('ul', { class: 'stack', style: 'margin:0;padding-left:var(--sp-4)' },
      h('li', {}, h('span', { class: 'badge ok' }, 'Bình thường'), ' Ứng dụng · uptime 30 ngày 99,9%'),
      h('li', {}, h('span', { class: 'badge warn' }, 'Cần chú ý'), ' Zalo OA "Gani Foods Sỉ miền Nam": token còn dưới 24 giờ ', ['owner', 'admin'].includes(Proto.role()) ? h('a', { href: `channels.html?role=${Proto.role()}&screen=detail&state=token_expiring` }, 'Xem kênh') : null),
      h('li', {}, h('span', { class: 'badge ok' }, 'Bình thường'), ' AI nội bộ (phân loại, tóm tắt)')));
}

function teamTable() {
  if (own() || !Proto.isManagerUp()) return null;
  return h('section', { class: 'card stack' },
    h('h2', {}, 'Theo nhân viên hôm nay'),
    h('table', { class: 'plain' },
      h('thead', {}, h('tr', {}, ['Nhân viên', 'Hội thoại', 'Phản hồi đầu (TB)', 'Quá hạn SLA'].map((c) => h('th', {}, c)))),
      h('tbody', {}, [['Hà Linh', 14, '3 phút 40 giây', 1], ['Trần Thu', 18, '2 phút 10 giây', 0], ['Vũ Nam', 9, '6 phút 05 giây', 2]].map((r) =>
        h('tr', {}, r.map((c) => h('td', {}, String(c))))))),
    h('p', { class: 'small muted' }, 'Trạng thái và số phút "Bận" của nhân viên nằm ở màn tải agent (S4, Q-U20-5).'));
}

Proto.mount({
  page: 'overview',
  states: [['normal', 'Bình thường'], ['loading', 'Đang tải'], ['empty', 'Trống'], ['error', 'Lỗi'], ['aioff', 'AI tắt']],
  variants: [{ label: 'Khoảng', name: 'range', options: [['today', 'Hôm nay'], ['7d', '7 ngày'], ['30d', '30 ngày']] }],
  render: () => {
    if (Proto.role() === 'platform_operator') {
      return h('div', { class: 'page-body' }, Proto.noAccess('Tổng quan của công ty — xem Sức khỏe công ty ở Platform', 'platform.html'));
    }
    const s = Proto.state();
    let body;
    if (s === 'loading') body = h('div', { class: 'tiles' }, [1, 2, 3, 4].map(() => h('div', { class: 'card' }, Proto.loading(3))));
    else if (s === 'error') body = h('div', { class: 'card' }, Proto.error('Không tải được số liệu tổng quan.'));
    else if (s === 'empty') body = h('div', { class: 'card' }, Proto.empty('Chưa có số liệu: workspace chưa nhận hội thoại nào. Kết nối kênh để bắt đầu.', null));
    else {
      const aiOff = s === 'aioff';
      body = h('div', { class: 'stack' },
        h('div', { class: 'tiles' }, tiles()),
        aiOff && !own() ? h('p', { class: 'small muted' }, 'AI đang tắt: số "Bot tự giải quyết" chỉ tính bot kịch bản; phân loại và tóm tắt tạm dừng.') : null,
        systemStatus(),
        teamTable());
    }
    return h('div', { class: 'main' },
      h('div', { class: 'page-head' },
        h('div', {}, h('h1', {}, 'Tổng quan'), h('p', { class: 'small muted' }, own() ? 'Số của bạn · ' : 'Workspace B2B · ', 'số liệu mẫu ', h('span', { class: 'pending-spec' }, 'danh sách chỉ số Đợt 1: chờ U29')))),
      Proto.aiOffBanner('Admin tắt bằng feature flag'),
      h('div', { class: 'page-body', style: 'overflow:auto' }, body));
  },
});
