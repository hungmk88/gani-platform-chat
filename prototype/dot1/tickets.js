/* global Proto, setTimeout, document */
/* #14 Danh sách ticket và #15 Chi tiết ticket (danh-sach-man-M11; I1, I2, I3). Sprint S4, nộp wireframe 21/12/2026.
   Quyền theo Phụ lục B: Owner, Admin, Manager, Support tạo và xử lý; Sales chỉ tạo; Marketing, Viewer không dùng. */
const { h } = Proto;

const ME = 'Hà Linh';
// Loại ticket và SLA chờ The Smile (Q8); trạng thái ticket chưa có trong Brief (U27). Đều là giá trị tạm.
const TYPES = ['Loại A', 'Loại B', 'Loại C'];
const STATUS = { new: 'Mới', working: 'Đang xử lý', waiting: 'Chờ khách', done: 'Đã xong' };

function seed() {
  return [
    { id: 't1', title: 'Hỏi lại hồ sơ quyết toán thuế', type: 'Loại A', status: 'new', owner: null, sla: 25, customer: 'Nguyễn Văn An', phone: '0900000001', known: true, from: 'Zalo OA · 19/10 09:12' },
    { id: 't2', title: 'Bổ sung hóa đơn tháng 9', type: 'Loại B', status: 'working', owner: ME, sla: 8, customer: 'Trần Thị Bình', phone: '0900000002', known: true, from: 'Zalo OA · 18/10 15:40' },
    { id: 't3', title: 'Xin lịch hẹn tư vấn', type: 'Loại C', status: 'waiting', owner: 'Trần Thu', sla: null, customer: 'Khách Zalo 8812', phone: null, known: false, from: 'Zalo OA · 18/10 10:02' },
    { id: 't4', title: 'Sai thông tin trên tờ khai', type: 'Loại A', status: 'working', owner: 'Vũ Nam', sla: -40, customer: 'Lê Minh', phone: '0900000003', known: true, from: 'Zalo OA · 17/10 08:30' },
    { id: 't5', title: 'Cập nhật địa chỉ công ty', type: 'Loại B', status: 'done', owner: ME, sla: null, customer: 'Phạm Hoa', phone: '0900000004', known: true, from: 'Zalo OA · 15/10 11:20' },
  ];
}

let tickets = seed();
const filter = { status: 'open', type: 'all', owner: 'all', sla: 'all' };
let openId = null;
let lastState = null;

function canHandle() {
  return ['owner', 'admin', 'manager', 'support'].includes(Proto.role());
}

function slaBadge(t) {
  if (t.status === 'done') return null;
  if (t.status === 'waiting') return h('span', { class: 'badge outline' }, 'SLA tạm dừng · chờ khách');
  if (t.sla === null) return null;
  if (t.sla < 0) return h('span', { class: 'badge error' }, `Quá hạn ${-t.sla} phút`);
  return h('span', { class: `badge ${t.sla < 15 ? 'error' : 'ok'}` }, `Còn ${t.sla} phút`);
}

function statusBadge(t) {
  const cls = t.status === 'new' ? 'warn' : t.status === 'done' ? '' : t.status === 'working' ? 'ok' : 'outline';
  return h('span', { class: `badge ${cls}` }, STATUS[t.status]);
}

function visible() {
  return tickets.filter((t) => {
    if (filter.status === 'open' && t.status === 'done') return false;
    if (filter.status !== 'open' && filter.status !== 'all' && t.status !== filter.status) return false;
    if (filter.type !== 'all' && t.type !== filter.type) return false;
    if (filter.owner === 'mine' && t.owner !== ME) return false;
    if (filter.owner === 'none' && t.owner !== null) return false;
    if (filter.sla === 'soon' && !(t.sla !== null && t.sla >= 0 && t.sla < 15 && t.status !== 'waiting')) return false;
    if (filter.sla === 'over' && !(t.sla !== null && t.sla < 0)) return false;
    return true;
  });
}

function select(label, key, options) {
  return h('label', { class: 'row small' }, label,
    h('select', { class: 'input', onchange: (e) => { filter[key] = e.target.value; Proto.render(); } },
      options.map(([v, text]) => h('option', { value: v, selected: filter[key] === v }, text))));
}

function filters() {
  return h('div', { class: 'row', style: 'margin-bottom:var(--sp-4);flex-wrap:wrap' },
    select('Trạng thái', 'status', [['open', 'Chưa xong'], ['all', 'Tất cả'], ...Object.entries(STATUS)]),
    select('Loại', 'type', [['all', 'Tất cả'], ...TYPES.map((t) => [t, t])]),
    select('Phụ trách', 'owner', [['all', 'Tất cả'], ['mine', 'Của tôi'], ['none', 'Chưa giao']]),
    select('SLA', 'sla', [['all', 'Tất cả'], ['soon', 'Sắp quá hạn'], ['over', 'Quá hạn']]));
}

function createTicket() {
  Proto.toast('Mở form tạo ticket: chọn loại, khách, mô tả. Thường tạo từ Hộp thư.');
}

/* #14 Danh sách ticket */
function list() {
  const rows = visible();
  if (!rows.length) return Proto.empty('Không có ticket khớp bộ lọc.', 'Xóa bộ lọc', () => { Object.assign(filter, { status: 'all', type: 'all', owner: 'all', sla: 'all' }); Proto.render(); });
  return h('table', { class: 'plain' },
    h('thead', {}, h('tr', {}, ['Ticket', 'Loại', 'Khách', 'Phụ trách', 'Trạng thái', 'SLA'].map((c) => h('th', {}, c)))),
    h('tbody', {}, rows.map((t) => h('tr', {},
      h('td', {}, h('button', { class: 'btn link ticket-open', onclick: () => { openId = t.id; Proto.render(); } }, t.title)),
      h('td', {}, t.type, ' ', h('span', { class: 'pending-spec' }, 'chờ Q8')),
      h('td', {}, t.customer),
      h('td', {}, t.owner || h('span', { class: 'muted' }, 'Chưa giao')),
      h('td', {}, statusBadge(t)),
      h('td', {}, slaBadge(t))))));
}

/* #15 Chi tiết ticket (drawer) */
function changeStatus(t, target, select) {
  select.disabled = true;
  t.busy = true;
  Proto.render();
  setTimeout(() => { t.busy = false; t.status = target; Proto.toast(`Đã chuyển sang "${STATUS[target]}".`); Proto.render(); }, 800);
}

function assign(t, button) {
  Proto.serverAction(button, 'Nhận xử lý', () => { t.owner = ME; if (t.status === 'new') t.status = 'working'; Proto.render(); });
}

function drawer() {
  const s = Proto.state();
  const t = tickets.find((x) => x.id === openId);
  if (!t) return null;
  let content;
  if (s === 'drawer_loading') content = Proto.loading(6);
  else if (s === 'drawer_error') content = Proto.error('Không tải được chi tiết ticket.');
  else {
    const handle = canHandle();
    const take = h('button', { class: 'btn primary' }, 'Nhận xử lý');
    take.addEventListener('click', () => assign(t, take));
    const statusSelect = h('select', { class: 'input', disabled: t.busy, onchange: (e) => changeStatus(t, e.target.value, statusSelect) },
      Object.entries(STATUS).map(([v, text]) => h('option', { value: v, selected: v === t.status }, text)));
    content = h('div', { class: 'stack' },
      h('div', { class: 'row' }, statusBadge(t), slaBadge(t)),
      h('dl', { class: 'kv' },
        h('dt', {}, 'Loại'), h('dd', {}, t.type, ' ', h('span', { class: 'pending-spec' }, 'chờ Q8')),
        h('dt', {}, 'Khách'), h('dd', {}, t.customer),
        h('dt', {}, 'SĐT'), h('dd', {}, t.phone ? Proto.maskPhone(t.phone) : '—'),
        h('dt', {}, 'Nhận diện (I2)'), h('dd', {}, t.known ? h('span', { class: 'badge ok' }, 'Khách hiện hữu (khớp SĐT)') : h('span', { class: 'badge outline' }, 'Chưa khớp khách nào')),
        h('dt', {}, 'Phụ trách (I3)'), h('dd', {}, t.owner || 'Chưa giao'),
        h('dt', {}, 'Nguồn'), h('dd', {}, t.from)),
      h('div', { class: 'row' },
        h('a', { class: 'btn', href: `customer.html?role=${Proto.role()}` }, 'Hồ sơ khách'),
        h('a', { class: 'btn', href: `inbox.html?role=${Proto.role()}` }, 'Hội thoại gốc')),
      handle && !t.owner ? h('div', {}, take) : null,
      handle && t.owner ? h('label', { class: 'field' }, 'Trạng thái', statusSelect) : null,
      handle ? null : h('p', { class: 'small muted' }, 'Vai trò của bạn chỉ tạo ticket, không xử lý.'),
      t.busy ? h('p', { class: 'row small muted' }, h('span', { class: 'spin', 'aria-hidden': 'true' }), 'Đang lưu…') : null,
      h('h3', {}, 'Lịch sử'),
      h('ol', { class: 'stack small', style: 'margin:0;padding-left:var(--sp-4)' },
        h('li', {}, `${t.from} · Tạo từ hội thoại`),
        t.owner ? h('li', {}, `Giao cho ${t.owner}`) : null,
        t.status === 'done' ? h('li', {}, 'Đã xong') : null));
  }
  return h('aside', { class: 'lead-drawer stack', role: 'dialog', 'aria-label': `Chi tiết ticket ${t.title}` },
    h('div', { class: 'spread' }, h('h2', {}, t.title), h('button', { class: 'btn', onclick: () => { openId = null; Proto.render(); }, 'aria-label': 'Đóng chi tiết ticket' }, 'Đóng')),
    content);
}

function body() {
  const s = Proto.state();
  if (s === 'loading') return Proto.loading(6);
  if (s === 'error') return Proto.error('Không tải được danh sách ticket.');
  if (s === 'empty') return Proto.empty('Chưa có ticket nào. Ticket được tạo từ Hộp thư khi khách cần hỗ trợ.', Proto.can('ticket.create') ? 'Tạo ticket' : null, createTicket);
  return h('div', {}, filters(), list());
}

document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && openId && !document.querySelector('.overlay')) { openId = null; Proto.render(); } });

Proto.mount({
  page: 'tickets',
  states: [['normal', 'Bình thường'], ['loading', 'Đang tải'], ['empty', 'Trống'], ['error', 'Lỗi'], ['aioff', 'AI tắt — Không áp dụng'], ['drawer', 'Chi tiết ticket (#15)'], ['drawer_loading', 'Chi tiết ticket — đang tải'], ['drawer_error', 'Chi tiết ticket — lỗi']],
  render: () => {
    if (!Proto.can('ticket.create')) return h('div', { class: 'page-body' }, Proto.noAccess('Ticket', 'customer.html'));
    const s = Proto.state();
    if (s !== lastState) { tickets = seed(); openId = s.startsWith('drawer') ? 't2' : null; lastState = s; }
    return h('div', { class: 'main' },
      h('div', { class: 'page-head' },
        h('div', {}, h('h1', {}, 'Ticket'), h('p', { class: 'small muted' }, 'Workspace The Smile — Dịch vụ. Loại ticket và SLA là giá trị tạm, chờ The Smile (Q8).')),
        h('button', { class: 'btn primary', onclick: createTicket }, 'Tạo ticket')),
      Proto.noAiNote(),
      h('div', { class: 'page-body' }, h('div', { class: 'card' }, body())),
      drawer());
  },
});
