/* global Proto */
/* #29 Sự cố bảo mật (danh-sach-man-M11; P11). Sprint S5, nộp wireframe 04/01/2027.
   Căn cứ: Phụ lục B dòng "Mở sự cố bảo mật" (Owner, Admin, Platform operator), Brief P17 (audit, thu hồi phiên, không ghi PII
   thô), P19 (runbook sự cố), CLAUDE.md quy tắc 5 (không ghi SĐT, email, nội dung tin). P11 chưa có định nghĩa trong danh-sach-109
   (U35): trường, thang mức độ, trạng thái, hạn và đối tượng phải thông báo, phạm vi của platform operator là dữ liệu tạm. */
const { h } = Proto;

const KINDS = ['Lộ dữ liệu', 'Truy cập trái phép', 'Mất thiết bị', 'Lỗ hổng', 'Khác'];
const LEVELS = { low: ['', 'Thấp'], medium: ['warn', 'Trung bình'], high: ['error', 'Cao'], critical: ['error', 'Nghiêm trọng'] };
const STATES = { open: ['error', 'Đang mở'], fixing: ['warn', 'Đang khắc phục'], closed: ['ok', 'Đã đóng'] };
const INCIDENTS = [
  { id: 'SC-0003', title: 'Điện thoại của một nhân viên Sales bị mất', kind: 'Mất thiết bị', level: 'high', state: 'fixing', found: '21/10/2026 18:40', by: 'Admin Gani', personal: 'Chưa rõ',
    log: [['21/10 18:40', 'Admin Gani', 'Mở sự cố.'], ['21/10 18:46', 'Admin Gani', 'Thu hồi mọi phiên của tài khoản Trần Thu, đặt lại 2FA.']],
    steps: { isolate: true, revoke: true, impact: false, notify: false, review: false } },
  { id: 'SC-0002', title: 'Đăng nhập sai liên tục từ một địa chỉ lạ', kind: 'Truy cập trái phép', level: 'medium', state: 'closed', found: '12/10/2026 02:10', by: 'Platform op', personal: 'Không',
    log: [['12/10 02:10', 'Platform op', 'Mở sự cố cho công ty Gani Foods.'], ['12/10 09:00', 'Owner Gani', 'Đóng: tài khoản bị khóa tự động 30 phút, không đăng nhập thành công.']],
    steps: { isolate: true, revoke: true, impact: true, notify: true, review: true } },
];
const STEPS = [['isolate', 'Cô lập: chặn nguồn, khóa tài khoản liên quan'], ['revoke', 'Thu hồi phiên, đặt lại 2FA, xoay khóa nếu cần'], ['impact', 'Đánh giá dữ liệu cá nhân bị ảnh hưởng'], ['notify', 'Thông báo cơ quan và khách bị ảnh hưởng'], ['review', 'Rút kinh nghiệm, cập nhật runbook']];
const PII = /(\+?84|0)\d{9}\b|[^@\s]+@[^@\s]+\.[^@\s]+/;
const pending = (text) => h('span', { class: 'pending-spec' }, text);
const operator = () => Proto.role() === 'platform_operator';

function openIncident() {
  const title = h('input', { id: 'sc-title', class: 'input', autofocus: true, maxlength: 120 });
  const kind = h('select', { id: 'sc-kind', class: 'input' }, KINDS.map((k) => h('option', {}, k)));
  const level = h('select', { id: 'sc-level', class: 'input' }, Object.entries(LEVELS).map(([k, [, label]]) => h('option', { value: k, selected: k === 'medium' }, label)));
  const personal = h('select', { id: 'sc-personal', class: 'input' }, ['Chưa rõ', 'Có', 'Không'].map((v) => h('option', {}, v)));
  const err = h('p', { class: 'field-error', role: 'alert' });
  Proto.dialog('Mở sự cố bảo mật', h('div', { class: 'stack' },
    h('div', { class: 'field' }, h('label', { for: 'sc-title' }, 'Tóm tắt (không ghi SĐT, email, mật khẩu, khóa)'), title),
    h('div', { class: 'field' }, h('label', { for: 'sc-kind' }, 'Loại'), kind),
    h('div', { class: 'field' }, h('label', { for: 'sc-level' }, 'Mức độ'), level),
    h('div', { class: 'field' }, h('label', { for: 'sc-personal' }, 'Có dữ liệu cá nhân bị ảnh hưởng?'), personal),
    h('p', { class: 'small muted' }, 'Mở sự cố gửi cảnh báo cho Owner, Admin và platform operator; ghi audit. Thang mức độ: ', pending('chờ U35')),
    err), (close) => [
    h('button', { class: 'btn', onclick: close }, 'Hủy'),
    h('button', { class: 'btn primary', onclick: (e) => {
      const value = title.value.trim();
      const problem = value.length < 10 ? 'Tóm tắt ít nhất 10 ký tự.' : PII.test(value) ? 'Bỏ SĐT, email khỏi tóm tắt: sự cố được ghi audit và gửi cảnh báo.' : null;
      err.textContent = problem ?? '';
      if (problem) { title.focus(); return; }
      Proto.serverAction(e.currentTarget, 'Mở sự cố', () => { close(); Proto.toast('Đã mở SC-0004, đã gửi cảnh báo. Ghi audit.'); });
    } }, 'Mở sự cố'),
  ]);
}

function closeIncident(inc) {
  const cause = h('textarea', { id: 'sc-cause', class: 'input', rows: 3 });
  const err = h('p', { class: 'field-error', role: 'alert' });
  const left = STEPS.filter(([k]) => !inc.steps[k]).map(([, label]) => label);
  Proto.dialog(`Đóng ${inc.id}`, h('div', { class: 'stack' },
    left.length ? h('div', { class: 'banner warn', role: 'status' }, `Còn ${left.length} bước chưa xong: ${left.join('; ')}.`) : null,
    h('div', { class: 'field' }, h('label', { for: 'sc-cause' }, 'Nguyên nhân và cách khắc phục (bắt buộc)'), cause),
    err), (close) => [
    h('button', { class: 'btn', onclick: close }, 'Hủy'),
    h('button', { class: 'btn primary', onclick: (e) => {
      const problem = left.length ? 'Hoàn tất các bước còn lại trước khi đóng.' : cause.value.trim().length < 10 ? 'Ghi nguyên nhân, ít nhất 10 ký tự.' : null;
      err.textContent = problem ?? '';
      if (!problem) Proto.serverAction(e.currentTarget, 'Đóng sự cố', () => { close(); Proto.toast(`Đã đóng ${inc.id}. Ghi audit.`); });
    } }, 'Đóng sự cố'),
  ]);
}

function detail(inc) {
  const done = inc.state === 'closed';
  return h('section', { class: 'card stack', 'aria-labelledby': 'sc-detail' },
    h('h2', { id: 'sc-detail' }, `${inc.id} · ${inc.title}`),
    h('p', { class: 'small' }, h('span', { class: `badge ${LEVELS[inc.level][0]}` }, LEVELS[inc.level][1]), ' ', h('span', { class: `badge ${STATES[inc.state][0]}` }, STATES[inc.state][1]), ` · ${inc.kind} · dữ liệu cá nhân: ${inc.personal}`),
    h('h3', {}, 'Các bước xử lý'),
    h('ul', { style: 'list-style:none;padding:0' }, STEPS.map(([k, label]) => h('li', {}, h('label', { class: 'row' },
      h('input', { type: 'checkbox', checked: inc.steps[k], disabled: done, onchange: () => Proto.toast(`${inc.id}: cập nhật bước "${label}". Ghi vào diễn biến.`) }), label,
      k === 'notify' ? pending('hạn và đối tượng: chờ U35') : null)))),
    done ? null : h('div', { class: 'row', role: 'group', 'aria-label': 'Thao tác nhanh' },
      h('a', { class: 'btn', href: `members.html?role=${operator() ? 'admin' : Proto.role()}` }, 'Thu hồi phiên, đặt lại 2FA'),
      h('a', { class: 'btn', href: `autonomy.html?role=${operator() ? 'owner' : Proto.role()}` }, 'Tắt AI, tắt cờ'),
      h('button', { class: 'btn', onclick: () => Proto.toast('Xoay khóa kênh Zalo OA: endpoint chờ U35.') }, 'Xoay khóa kênh')),
    h('h3', {}, 'Diễn biến'),
    h('ol', {}, inc.log.map(([at, who, text]) => h('li', {}, h('span', { class: 'small muted' }, `${at} · ${who}: `), text))),
    done ? null : h('div', { class: 'row' },
      h('button', { class: 'btn', onclick: () => Proto.toast('Thêm diễn biến: chỉ ghi id, không ghi SĐT, email, nội dung tin.') }, 'Thêm diễn biến'),
      h('button', { class: 'btn primary', onclick: () => closeIncident(inc) }, 'Đóng sự cố…')));
}

function list() {
  const current = INCIDENTS.find((i) => i.id === Proto.get('id', 'SC-0003')) ?? INCIDENTS[0];
  return h('div', { class: 'stack' },
    h('div', { class: 'card', style: 'overflow:auto' }, h('table', { class: 'plain' },
      h('thead', {}, h('tr', {}, ['Mã', 'Tóm tắt', 'Mức độ', 'Trạng thái', 'Phát hiện', 'Người mở'].map((c) => h('th', {}, c)))),
      h('tbody', {}, INCIDENTS.map((i) => h('tr', { 'aria-current': i === current ? 'true' : null },
        h('td', {}, h('button', { class: 'btn link', onclick: () => Proto.set('id', i.id) }, i.id)),
        h('td', {}, i.title),
        h('td', {}, h('span', { class: `badge ${LEVELS[i.level][0]}` }, LEVELS[i.level][1])),
        h('td', {}, h('span', { class: `badge ${STATES[i.state][0]}` }, STATES[i.state][1])),
        h('td', {}, i.found),
        h('td', {}, i.by)))))),
    detail(current));
}

Proto.mount({
  page: 'security',
  states: [['normal', 'Bình thường'], ['loading', 'Đang tải'], ['empty', 'Trống'], ['error', 'Lỗi'], ['aioff', 'AI tắt — Không áp dụng']],
  render: () => {
    if (!['owner', 'admin', 'platform_operator'].includes(Proto.role())) {
      return h('div', { class: 'page-body' }, Proto.noAccess('Sự cố bảo mật (Owner, Admin, Platform operator)', Proto.can('inbox.view') ? 'inbox.html' : 'customers.html'));
    }
    const s = Proto.state();
    const body = s === 'loading' ? Proto.loading(5) : s === 'error' ? h('div', { class: 'card' }, Proto.error('Không tải được danh sách sự cố.')) : s === 'empty' ? h('div', { class: 'card' }, Proto.empty('Chưa có sự cố bảo mật nào.', 'Mở sự cố', openIncident)) : list();
    return h('div', { class: 'main' },
      h('div', { class: 'page-head' },
        h('div', {}, h('h1', {}, 'Sự cố bảo mật'), h('p', { class: 'small muted' }, operator() ? 'Platform operator · công ty Gani Foods. ' : 'Công ty Gani Foods. ', 'Mọi thao tác ghi audit. ', pending('trường, mức độ, trạng thái và hạn thông báo chờ U35'), operator() ? pending(' thấy sự cố của mọi công ty hay chỉ sự cố mình mở: chờ U35') : null)),
        s === 'empty' ? null : h('button', { class: 'btn primary', onclick: openIncident }, 'Mở sự cố')),
      Proto.noAiNote(),
      h('div', { class: 'page-body stack', style: 'max-width:1100px' }, body));
  },
});
