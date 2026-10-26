/* global Proto */
/* Hồ sơ khách (Brief UI §6.2). Dữ liệu là mẫu. */
const { h } = Proto;

const customer = {
  name: 'Nguyễn Văn An',
  company: 'Quán Phở Hà Nội',
  type: 'Doanh nghiệp',
  owner: 'Hà Linh',
  identities: [
    { channel: 'Zalo OA', value: 'UID 4471…', level: 'verified' },
    { channel: 'SĐT', value: '0900000001', level: 'unverified', phone: true },
    { channel: 'SĐT', value: '0280000001', level: 'sales_confirmed', phone: true },
  ],
  custom: [['Loại hình', 'Quán ăn'], ['Khu vực giao', 'TP.HCM']],
  tags: ['Khách sỉ', 'Hỏi giá'],
  conversations: [
    { title: 'Zalo OA · hôm nay', state: 'Chờ nhân viên nhận' },
    { title: 'Zalo OA · 02/10', state: 'Đã đóng — Đã xong' },
  ],
  leads: [{ title: 'Bánh phở khô sỉ', stage: 'Bước 3 (tên tạm)', status: 'Đang mở' }],
  tickets: [{ title: 'Đổi lịch giao', type: 'Giao hàng', status: 'Đang xử lý' }],
  notes: [{ by: 'Trần Thu', text: 'Khách ưu tiên giao buổi sáng.', at: '03/10' }],
  humanOnly: false,
};
/* Tag có sẵn của công ty (#23 quản lý). Sales, Support gắn/bỏ trên hồ sơ, không tạo tag mới ở đây (spec M8 §3.7); chờ API J4. */
const TAG_LIST = ['Khách sỉ', 'bò viên', 'Hỏi giá', 'Khách mới', 'VIP'];
const other = { name: 'An Nguyễn', company: 'Phở Hà Nội Q.3', phone: '0900000001', owner: 'Vũ Nam', tags: ['Khách mới'] };
const LEVEL = { verified: ['ok', 'Đã xác thực'], unverified: ['outline', 'Chưa xác thực'], sales_confirmed: ['ok', 'Sales xác nhận'] };
let tab = 'conversations';

function levelBadge(level) {
  const [cls, text] = LEVEL[level];
  return h('span', { class: `badge ${cls}`, title: level }, text);
}

function infoCard() {
  const masked = !Proto.can('customer.phone.full');
  return h('div', { class: 'stack' },
    h('section', { class: 'card stack', 'aria-label': 'Thông tin cơ bản' },
      h('h2', {}, 'Thông tin'),
      h('dl', { class: 'kv' },
        h('dt', {}, 'Tên'), h('dd', {}, customer.name),
        h('dt', {}, 'Công ty'), h('dd', {}, customer.company),
        h('dt', {}, 'Loại khách'), h('dd', {}, customer.type),
        h('dt', {}, 'Phụ trách'), h('dd', {}, customer.owner),
        customer.custom.map(([k, v]) => [h('dt', {}, k), h('dd', {}, v, ' ', h('span', { class: 'pending-spec' }, 'chờ spec J1'))]))),
    h('section', { class: 'card stack', 'aria-label': 'Định danh đa kênh' },
      h('h2', {}, 'Định danh'),
      masked ? h('p', { class: 'small muted' }, 'SĐT hiển thị dạng che theo vai trò của bạn.') : null,
      h('table', { class: 'plain' }, customer.identities.map((i) => h('tr', {}, h('td', { class: 'muted' }, i.channel), h('td', {}, i.phone ? Proto.maskPhone(i.value) : i.value), h('td', {}, levelBadge(i.level)))))),
    h('section', { class: 'card stack', 'aria-label': 'Tag và cờ' },
      h('h2', {}, 'Tag'),
      h('div', { class: 'row' }, customer.tags.map((t) => h('span', { class: 'badge outline' }, t,
        Proto.can('customer.edit') ? h('button', { class: 'btn link small', 'aria-label': `Bỏ tag ${t}`, onclick: () => { customer.tags = customer.tags.filter((x) => x !== t); Proto.render(); } }, '×') : null))),
      Proto.can('customer.edit') && TAG_LIST.some((t) => !customer.tags.includes(t))
        ? h('div', { class: 'field' }, h('label', { for: 'add-tag' }, 'Gắn tag có sẵn'),
          h('select', { id: 'add-tag', class: 'input', onchange: (e) => { if (e.target.value) { customer.tags.push(e.target.value); Proto.render(); } } },
            h('option', { value: '' }, 'Chọn tag…'), TAG_LIST.filter((t) => !customer.tags.includes(t)).map((t) => h('option', { value: t }, t))))
        : null,
      h('label', { class: 'row' }, h('input', { type: 'checkbox', checked: customer.humanOnly, disabled: !Proto.can('customer.edit'), onchange: (e) => { customer.humanOnly = e.target.checked; Proto.render(); } }), 'Chỉ người phục vụ (§28)'),
      h('p', { class: 'small muted' }, 'Đồng ý nhận tin theo kênh (J7) hiện từ Đợt 2.')));
}

function tabPanel() {
  const empty = Proto.state() === 'empty';
  const panels = {
    conversations: () => (empty || !customer.conversations.length
      ? Proto.empty('Khách chưa có hội thoại nào.', Proto.can('inbox.view') ? 'Mở Hộp thư' : null, () => Proto.toast('Mở Hộp thư.'))
      : h('table', { class: 'plain' }, customer.conversations.map((c) => h('tr', {}, h('td', {}, c.title), h('td', {}, h('span', { class: 'badge outline' }, c.state)), h('td', {}, Proto.can('inbox.view') ? h('a', { href: `inbox.html?role=${Proto.role()}` }, 'Mở') : null))))),
    leads: () => (empty
      ? Proto.empty('Khách chưa có lead.', Proto.can('lead.change') ? 'Tạo lead' : null, () => Proto.toast('Đã tạo lead.'))
      : h('table', { class: 'plain' }, customer.leads.map((l) => h('tr', {}, h('td', {}, l.title), h('td', {}, l.stage), h('td', {}, h('span', { class: 'badge outline' }, l.status)), h('td', {}, h('a', { href: `leads.html?role=${Proto.role()}` }, 'Mở pipeline')))))),
    tickets: () => (empty
      ? Proto.empty('Khách chưa có ticket.', Proto.can('ticket.create') ? 'Tạo ticket' : null, () => Proto.toast('Đã tạo ticket.'))
      : h('table', { class: 'plain' }, customer.tickets.map((t) => h('tr', {}, h('td', {}, t.title), h('td', {}, h('span', { class: 'pending-spec' }, `${t.type} · chờ O2`)), h('td', {}, h('span', { class: 'badge outline' }, t.status)))))),
    notes: () => h('div', { class: 'stack' },
      (empty ? [] : customer.notes).map((n) => h('div', { class: 'msg note', style: 'max-width:100%;align-self:stretch' }, h('strong', { class: 'small', style: 'display:block' }, `${n.by} · Nội bộ`), n.text, h('span', { class: 'meta' }, n.at))),
      empty ? h('p', { class: 'muted' }, 'Chưa có ghi chú.') : null,
      Proto.can('inbox.reply') ? noteForm() : null),
  };
  const labels = [['conversations', 'Hội thoại'], ['leads', 'Lead'], ['tickets', 'Ticket'], ['notes', 'Ghi chú']];
  return h('section', { class: 'card stack' },
    h('div', { class: 'tabs', role: 'tablist' }, labels.map(([k, v]) => h('button', { role: 'tab', 'aria-selected': String(tab === k), onclick: () => { tab = k; Proto.render(); } }, v))),
    h('div', { role: 'tabpanel' }, panels[tab]()),
    h('p', { class: 'small muted' }, 'Tab Báo giá và Đơn thêm ở Đợt 2.'));
}

function noteForm() {
  const area = h('textarea', { class: 'input', rows: 2, 'aria-label': 'Ghi chú nội bộ mới' });
  return h('div', { class: 'stack' }, area, h('div', {}, h('button', { class: 'btn', onclick: () => {
    if (!area.value.trim()) return;
    customer.notes.push({ by: 'Bạn', text: area.value.trim(), at: 'Vừa xong' }); // hiện ngay, hoàn tác khi lỗi
    Proto.render();
  } }, 'Lưu ghi chú')));
}

function mergeBanner() {
  const role = Proto.role();
  const action = Proto.can('customer.merge') ? 'Xem và gộp' : Proto.can('customer.merge.confirm') ? 'Xác nhận đề xuất' : null;
  return h('div', { class: 'banner warn', role: 'status' },
    `Đề xuất gộp: "${other.name}" trùng SĐT ${Proto.maskPhone(other.phone)}. SĐT chưa xác thực nên không gộp tự động (§12). `,
    action ? h('button', { class: 'btn', onclick: () => Proto.set('state', 'merge') }, action) : h('span', {}, `Vai trò ${Proto.ROLE_LABEL[role]} không gộp được.`));
}

function mergeScreen() {
  const fields = [['Tên', customer.name, other.name], ['Công ty', customer.company, other.company], ['Phụ trách', customer.owner, other.owner], ['Tag', customer.tags.join(', '), other.tags.join(', ')]];
  return h('div', { class: 'stack' },
    h('div', { class: 'card stack' },
      h('h2', {}, 'Gộp 2 hồ sơ'),
      h('p', { class: 'muted' }, 'Chọn giá trị giữ lại cho từng trường. Hội thoại, lead, ticket của cả hai được gom về hồ sơ sau gộp. SĐT chưa xác thực: không liên kết đơn/công nợ B2B (§12). Thao tác ghi audit.'),
      h('div', { class: 'merge-grid', role: 'group', 'aria-label': 'Chọn giá trị giữ lại' },
        h('span', {}), h('strong', {}, 'Hồ sơ này'), h('strong', {}, 'Hồ sơ đề xuất'),
        fields.map(([label, a, b], i) => [h('span', { class: 'muted' }, label),
          h('label', {}, h('input', { type: 'radio', name: `f${i}`, checked: true }), a),
          h('label', {}, h('input', { type: 'radio', name: `f${i}` }), b)]))),
    h('div', { class: 'row' },
      h('button', { class: 'btn', onclick: () => Proto.set('state', 'merge_suggestion') }, 'Hủy'),
      h('button', { class: 'btn primary', onclick: (e) => Proto.serverAction(e.currentTarget, 'Xác nhận gộp', () => { Proto.toast('Đã gộp hồ sơ. Đã ghi audit.'); Proto.set('state', 'normal'); }) }, 'Xác nhận gộp')));
}

function editDialog() {
  const name = h('input', { id: 'e-name', class: 'input', value: customer.name });
  const err = h('p', { class: 'field-error', role: 'alert' });
  Proto.dialog('Sửa hồ sơ', h('div', { class: 'stack' }, h('div', { class: 'field' }, h('label', { for: 'e-name' }, 'Tên (1–100 ký tự)'), name, err), h('div', { class: 'field' }, h('label', { for: 'e-co' }, 'Công ty'), h('input', { id: 'e-co', class: 'input', value: customer.company }))), (close) => [
    h('button', { class: 'btn', onclick: close }, 'Hủy'),
    h('button', { class: 'btn primary', onclick: (e) => {
      if (!name.value.trim()) { name.classList.add('invalid'); err.textContent = 'Nhập tên khách.'; return; }
      Proto.serverAction(e.currentTarget, 'Lưu', () => { customer.name = name.value.trim(); close(); Proto.render(); });
    } }, 'Lưu'),
  ]);
}

function unmergeDialog() {
  Proto.dialog('Tách hồ sơ đã gộp?', h('p', {}, 'Tách lại hồ sơ "An Nguyễn" đã gộp ngày 05/10. Hội thoại và lead trở về hồ sơ gốc. Ghi audit.'), (close) => [
    h('button', { class: 'btn', onclick: close }, 'Hủy'),
    h('button', { class: 'btn primary', onclick: (e) => Proto.serverAction(e.currentTarget, 'Tách', () => { close(); Proto.toast('Đã tách hồ sơ.'); }) }, 'Tách'),
  ]);
}

function body() {
  const s = Proto.state();
  if (s === 'loading') return h('div', { class: 'profile' }, h('div', { class: 'card' }, Proto.loading(8)), h('div', { class: 'card' }, Proto.loading(6)));
  if (s === 'error') return h('div', { class: 'card' }, Proto.error('Không tải được hồ sơ khách.'));
  if (s === 'merge') return mergeScreen();
  return h('div', { class: 'profile' }, infoCard(), tabPanel());
}

Proto.mount({
  page: 'customers',
  states: [['normal', 'Bình thường'], ['loading', 'Đang tải'], ['empty', 'Trống'], ['error', 'Lỗi'], ['aioff', 'AI tắt'], ['merge_suggestion', 'Có đề xuất gộp'], ['human_only', 'Cờ chỉ người phục vụ'], ['merge', 'Màn gộp 2 hồ sơ']],
  render: () => {
    customer.humanOnly = customer.humanOnly || Proto.state() === 'human_only';
    return h('div', { class: 'main' },
      h('div', { class: 'page-head' },
        h('div', {}, h('p', { class: 'small muted' }, 'Khách hàng ›'), h('h1', {}, customer.name)),
        h('div', { class: 'row' },
          Proto.can('customer.unmerge') ? h('button', { class: 'btn', onclick: unmergeDialog }, 'Tách hồ sơ đã gộp') : null,
          Proto.can('customer.edit') ? h('button', { class: 'btn primary', onclick: editDialog }, 'Sửa hồ sơ') : h('span', { class: 'badge outline' }, 'Chỉ xem'))),
      Proto.noAiNote(),
      Proto.state() === 'merge_suggestion' ? mergeBanner() : null,
      customer.humanOnly ? h('div', { class: 'banner info', role: 'status' }, 'Khách yêu cầu chỉ người phục vụ: bot không xử lý nội dung của khách này.') : null,
      h('div', { class: 'page-body' }, body()));
  },
});
