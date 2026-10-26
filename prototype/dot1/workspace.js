/* global document, Proto */
/* #21 Workspace, 3 tab (danh-sach-man-M11; A2, C8, C9, C10, D4). Sprint S4, nộp wireframe 21/12/2026.
   Căn cứ: spec M8 §3.3 SLA & ưu tiên, §3.4 Giờ làm việc + trạng thái agent (U20-4/5, Q-U20-4), §3.5 Phân bổ (Q-M8-1: không theo
   kỹ năng ở Đợt 1). Chỉ Owner, Admin: Manager không vào (U39, 26/10). SĐT liên hệ là {{company_phone}} của mẫu trả lời (N163).
   Giới hạn tải mặc định 1–100 (N157). Giá trị lịch là tạm, chờ Q7 (U18, U20-6); nghỉ trưa sửa được, chờ API C10. */
const { h } = Proto;

const TABS = [['info', 'Thông tin & giờ làm việc'], ['sla', 'SLA & ưu tiên'], ['allocation', 'Phân bổ']];
const DAYS = [['T2', '08:00', '17:30'], ['T3', '08:00', '17:30'], ['T4', '08:00', '17:30'], ['T5', '08:00', '17:30'], ['T6', '08:00', '17:30'], ['T7', '08:00', '12:00'], ['CN', null, null]];
const canEdit = () => ['owner', 'admin'].includes(Proto.role());
const pending = (text) => h('span', { class: 'pending-spec' }, text);
const field = (id, label, control, hint) => h('div', { class: 'field' }, h('label', { for: id }, label), control, hint ? h('p', { class: 'small muted' }, hint) : null);
const input = (id, value, extra = {}) => h('input', { id, class: 'input', value, disabled: !canEdit(), ...extra });

function saveBar(label, check) {
  if (!canEdit()) return h('p', { class: 'small muted' }, 'Manager chỉ xem. Owner, Admin sửa được.');
  const err = h('p', { class: 'field-error', role: 'alert' });
  const save = h('button', { class: 'btn primary', onclick: (e) => {
    const problem = check ? check() : null;
    err.textContent = problem ?? '';
    if (!problem) Proto.serverAction(e.currentTarget, 'Lưu', () => Proto.toast(`${label}: đã lưu. Hội thoại mới áp dụng ngay; hội thoại đang mở giữ hạn cũ. Ghi audit.`));
  } }, 'Lưu');
  return h('div', { class: 'stack' }, err, h('div', {}, save));
}

function infoTab() {
  const rows = DAYS.map(([day, open, close]) => h('tr', {},
    h('th', { scope: 'row' }, day),
    h('td', {}, open ? input(`open-${day}`, open, { type: 'time', 'aria-label': `${day} mở cửa` }) : h('span', { class: 'small muted' }, 'Nghỉ')),
    h('td', {}, close ? input(`close-${day}`, close, { type: 'time', 'aria-label': `${day} đóng cửa` }) : null),
    h('td', {}, open && day !== 'T7' ? h('span', { class: 'row' },
      input(`lunch-from-${day}`, '12:00', { type: 'time', 'aria-label': `${day} nghỉ trưa từ` }),
      input(`lunch-to-${day}`, '13:00', { type: 'time', 'aria-label': `${day} nghỉ trưa đến` })) : null)));
  const check = () => {
    for (const [day, open] of DAYS) {
      const o = document.getElementById(`open-${day}`)?.value;
      const c = document.getElementById(`close-${day}`)?.value;
      if (open && o && c && o >= c) return `${day}: giờ đóng cửa phải sau giờ mở cửa.`;
      const lf = document.getElementById(`lunch-from-${day}`)?.value;
      const lt = document.getElementById(`lunch-to-${day}`)?.value;
      if (lf && lt && lf >= lt) return `${day}: giờ hết nghỉ trưa phải sau giờ bắt đầu.`;
    }
    return null;
  };
  return h('div', { class: 'stack' },
    h('section', { class: 'card stack' }, h('h2', {}, 'Thông tin'),
      field('ws-name', 'Tên workspace', input('ws-name', 'Gani Foods B2B')),
      h('p', { class: 'small muted' }, 'Mẫu: B2B (chọn khi tạo bằng script, không đổi ở đây — spec M8 A2).'),
      field('ws-tz', 'Múi giờ', h('select', { id: 'ws-tz', class: 'input', disabled: !canEdit() }, h('option', {}, 'Asia/Ho_Chi_Minh (GMT+7)'))),
      field('ws-phone', 'SĐT liên hệ (không bắt buộc)', input('ws-phone', '028 3812 3456', { type: 'tel', autocomplete: 'off' }), 'Số khách gọi: điền vào {{company_phone}} của mẫu trả lời nhanh. Để trống là chưa đặt (N163).')),
    h('section', { class: 'card stack' }, h('h2', {}, 'Giờ làm việc ', pending('giá trị tạm: chờ Q7')),
      h('div', { style: 'overflow:auto' }, h('table', { class: 'plain' },
        h('thead', {}, h('tr', {}, ['Ngày', 'Mở cửa', 'Đóng cửa', 'Nghỉ trưa'].map((t) => h('th', {}, t)))),
        h('tbody', {}, rows))),
      h('h3', {}, 'Ngày nghỉ lễ'),
      h('ul', {}, h('li', {}, 'Tết Nguyên đán: 04/02/2027 – 10/02/2027 (ngoài giờ cả ngày)')),
      canEdit() ? h('div', {}, h('button', { class: 'btn', onclick: () => Proto.toast('Thêm ngày nghỉ: chọn ngày bắt đầu, ngày kết thúc, tên.') }, 'Thêm ngày nghỉ')) : null,
      h('p', { class: 'small muted' }, 'Ngoài giờ và ngày nghỉ: đồng hồ SLA dừng, bot giữ hội thoại và gửi lời nhắn của flow "Ngoài giờ" (sửa ở Tự động hóa).')),
    h('section', { class: 'card stack' }, h('h2', {}, 'Trạng thái agent (chỉ đọc)'),
      h('table', { class: 'plain' },
        h('thead', {}, h('tr', {}, ['Trạng thái', 'Nhận hội thoại mới', 'Giữ hội thoại đang xử lý', 'Về hàng chờ sau 10 phút'].map((t) => h('th', {}, t)))),
        h('tbody', {},
          h('tr', {}, h('td', {}, 'Online'), h('td', {}, 'Có'), h('td', {}, 'Có'), h('td', {}, 'Không')),
          h('tr', {}, h('td', {}, 'Bận'), h('td', {}, 'Không'), h('td', {}, 'Có'), h('td', {}, 'Không, kể cả quá 10 phút')),
          h('tr', {}, h('td', {}, 'Offline'), h('td', {}, 'Không'), h('td', {}, 'Không'), h('td', {}, 'Có, nếu khách còn tin chưa trả lời')))),
      h('p', { class: 'small muted' }, 'Mất kết nối quá 5 phút thì tự chuyển Offline; nối lại không tự Online. Chỉ Owner, Admin đổi trạng thái của người khác.')),
    saveBar('Giờ làm việc', check));
}

function slaTab() {
  const levels = [['Thường', '15', '8'], ['Cao', '10', '4'], ['Khẩn', '5', '2']];
  return h('div', { class: 'stack' },
    h('section', { class: 'card stack' }, h('h2', {}, 'Chỉ tiêu theo mức ưu tiên'),
      h('div', { style: 'overflow:auto' }, h('table', { class: 'plain' },
        h('thead', {}, h('tr', {}, ['Mức', 'Phản hồi đầu tiên (phút)', 'Xử lý xong (giờ)'].map((t) => h('th', {}, t)))),
        h('tbody', {}, levels.map(([name, first, done]) => h('tr', {},
          h('th', { scope: 'row' }, name),
          h('td', {}, input(`first-${name}`, first, { type: 'number', min: 1, 'aria-label': `${name}: phản hồi đầu tiên, phút` })),
          h('td', {}, input(`done-${name}`, done, { type: 'number', min: 1, 'aria-label': `${name}: xử lý xong, giờ` }))))))),
      h('p', { class: 'small muted' }, 'Hội thoại mới mặc định "Thường"; agent, Manager đổi mức trong Hộp thư.')),
    h('section', { class: 'card stack' }, h('h2', {}, 'Cảnh báo'),
      field('warn-agent', 'Báo agent trước hạn (phút)', input('warn-agent', '15', { type: 'number', min: 1 })),
      field('warn-manager', 'Báo quản lý khi quá hạn (phút)', input('warn-manager', '30', { type: 'number', min: 1 }))),
    h('section', { class: 'card stack' }, h('h2', {}, 'Khi nào đồng hồ dừng (chỉ đọc)'),
      h('ul', {}, h('li', {}, 'Ngoài giờ làm việc và ngày nghỉ lễ: chạy tiếp từ giờ mở cửa kế tiếp.'), h('li', {}, 'Hội thoại "Chờ khách trả lời": chạy tiếp khi khách trả lời.'))),
    saveBar('SLA', () => (levels.some(([n]) => !(Number(document.getElementById(`first-${n}`)?.value) >= 1)) ? 'Mỗi chỉ tiêu là số phút/giờ từ 1 trở lên.' : null)));
}

function allocationTab() {
  const teams = [['Sales B2B', 'Tự động xoay vòng'], ['CSKH', 'Agent tự nhận']];
  return h('div', { class: 'stack' },
    h('section', { class: 'card stack' }, h('h2', {}, 'Cách phân bổ theo team ', pending('danh sách team: chờ Q7')),
      h('table', { class: 'plain' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Team'), h('th', {}, 'Cách phân bổ'))),
        h('tbody', {}, teams.map(([team, mode]) => h('tr', {},
          h('th', { scope: 'row' }, team),
          h('td', {}, h('select', { class: 'input', disabled: !canEdit(), 'aria-label': `Cách phân bổ của ${team}` }, ['Tự động xoay vòng', 'Agent tự nhận'].map((o) => h('option', { selected: o === mode }, o))))))))),
    h('section', { class: 'card stack' }, h('h2', {}, 'Giới hạn tải'),
      field('cap-default', 'Số hội thoại đang xử lý tối đa của mỗi agent', input('cap-default', '5', { type: 'number', min: 1, max: 100 }), 'Giới hạn riêng từng người sửa ở Cài đặt › Thành viên. Đầy tải: không được phân bổ thêm, vẫn tự nhận được kèm cảnh báo.'),
      h('label', { class: 'row' }, h('input', { type: 'checkbox', checked: true, disabled: !canEdit() }), 'Ưu tiên người đã xử lý khách này lần trước (nếu đang Online, chưa đầy tải)')),
    h('p', { class: 'small muted' }, 'Phân bổ theo kỹ năng: Đợt 2 (Q-M8-1).'),
    saveBar('Phân bổ', () => { const n = Number(document.getElementById('cap-default')?.value); return Number.isInteger(n) && n >= 1 && n <= 100 ? null : 'Giới hạn tải là số nguyên từ 1 đến 100.'; }));
}

Proto.mount({
  page: 'workspace',
  states: [['normal', 'Bình thường'], ['loading', 'Đang tải'], ['error', 'Lỗi'], ['aioff', 'AI tắt — Không áp dụng']],
  render: () => {
    if (!canEdit()) {
      return h('div', { class: 'page-body' }, Proto.noAccess('Cài đặt workspace (chỉ Owner, Admin)', Proto.can('inbox.view') ? 'inbox.html' : 'customer.html'));
    }
    const s = Proto.state();
    const tab = Proto.get('tab', 'info');
    const body = s === 'loading' ? Proto.loading(8) : s === 'error' ? h('div', { class: 'card' }, Proto.error('Không tải được cài đặt workspace.')) : tab === 'sla' ? slaTab() : tab === 'allocation' ? allocationTab() : infoTab();
    return h('div', { class: 'main' },
      h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Workspace'), h('p', { class: 'small muted' }, 'Gani Foods B2B · Trống: không áp dụng, workspace luôn có giá trị từ mẫu. ', Proto.role() === 'manager' ? pending('Manager xem: spec M8 §3.3–3.5; Phụ lục B chỉ ghi Owner/Admin, chờ chốt') : null))),
      h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Phần cài đặt' }, TABS.map(([k, label]) => h('button', { role: 'tab', id: `tab-${k}`, 'aria-selected': String(tab === k), onclick: () => Proto.set('tab', k) }, label))),
      Proto.noAiNote(),
      h('div', { class: 'page-body', style: 'max-width:880px' }, body));
  },
});
