/* global Proto */
/* #7 Danh sách khách (danh-sach-man-M11; J1, J2, J4, J5, J6). Sprint S4, nộp wireframe 21/12/2026.
   Căn cứ: spec M8 §3.7 (tìm theo tên, SĐT, email; lọc theo tag, kênh, trường tùy chỉnh, người phụ trách, ngày liên hệ cuối;
   không có "Lưu bộ lọc" — Q-M8-2), §3.6 (trường mới có ngay trong bộ lọc), Phụ lục B (mọi vai trò công ty xem danh sách;
   Marketing, Viewer thấy SĐT che; Gộp khách: Owner, Admin, Manager; Nhập, Xuất: Owner, Admin). Hồ sơ khách: #8 customer.html.
   Brief UI §6.1 chưa có trong repo: cột và bộ lọc theo spec M8, chỗ nào chưa chốt có nhãn chờ. */
const { h } = Proto;

const CUSTOMERS = [
  { id: 'c1', name: 'Nguyễn Văn An', company: 'Quán Phở Hà Nội', phone: '0900000001', email: 'an@example.test', channels: ['Zalo OA'], tags: ['Khách sỉ', 'bò viên'], kind: 'Quán ăn', owner: 'Hà Linh', last: '21/10/2026', lastDays: 0 },
  { id: 'c2', name: 'Trần Thị Bình', company: 'Nhà hàng Sen', phone: '0900000002', email: 'binh@example.test', channels: ['Zalo OA'], tags: ['Hỏi giá'], kind: 'Nhà hàng', owner: 'Trần Thu', last: '19/10/2026', lastDays: 2, aiTag: true },
  { id: 'c3', name: 'Lê Minh Châu', company: '—', phone: '0900000003', email: null, channels: ['Zalo OA'], tags: [], kind: null, owner: null, last: '02/10/2026', lastDays: 19 },
  { id: 'c4', name: 'Phạm Quốc Dũng', company: 'Đại lý Dũng Phát', phone: '0900000004', email: 'dung@example.test', channels: ['Zalo OA', 'SĐT'], tags: ['Khách sỉ'], kind: 'Đại lý', owner: 'Lê Quân', last: '15/09/2026', lastDays: 36 },
  { id: 'c5', name: 'Khách Zalo 4471', company: '—', phone: null, email: null, channels: ['Zalo OA'], tags: [], kind: null, owner: null, last: '20/10/2026', lastDays: 1 },
];
const TAG_LIST = ['Khách sỉ', 'bò viên', 'Hỏi giá'];
const OWNERS = ['Hà Linh', 'Trần Thu', 'Lê Quân'];
const KINDS = ['Quán ăn', 'Nhà hàng', 'Đại lý'];
const RANGES = [['', 'Mọi lúc'], ['7', '7 ngày qua'], ['30', '30 ngày qua'], ['older', 'Hơn 30 ngày']];
const fold = (s) => (s ?? '').normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/g, 'd').toLowerCase();
const can = (roles) => roles.includes(Proto.role());
const aiOff = () => Proto.state() === 'aioff';

function matches(c, f) {
  const q = fold(f.q).trim();
  const digits = f.q.replace(/\D/g, '');
  const tags = c.tags.filter((t) => !(aiOff() && c.aiTag && t === 'Hỏi giá'));
  if (q && !(fold(c.name).includes(q) || fold(c.email).includes(q) || (digits.length >= 3 && (c.phone ?? '').includes(digits)))) return false;
  if (f.tag && !tags.includes(f.tag)) return false;
  if (f.owner && (f.owner === 'none' ? c.owner : c.owner !== f.owner)) return false;
  if (f.kind && c.kind !== f.kind) return false;
  if (f.range === '7' && c.lastDays > 7) return false;
  if (f.range === '30' && c.lastDays > 30) return false;
  if (f.range === 'older' && c.lastDays <= 30) return false;
  return true;
}

function filters(f) {
  const select = (id, label, value, options) => h('div', { class: 'field' }, h('label', { for: id }, label),
    h('select', { id, class: 'input', onchange: (e) => Proto.set(id.replace('f-', ''), e.target.value) }, options.map(([v, text]) => h('option', { value: v, selected: v === value }, text))));
  const search = h('input', { id: 'f-q', class: 'input', type: 'search', value: f.q, placeholder: 'Tên, SĐT hoặc email' });
  search.addEventListener('change', () => Proto.set('q', search.value));
  return h('div', { class: 'row', style: 'flex-wrap:wrap;align-items:flex-end' },
    h('div', { class: 'field' }, h('label', { for: 'f-q' }, 'Tìm khách'), search),
    select('f-tag', 'Tag', f.tag, [['', 'Mọi tag'], ...TAG_LIST.filter((t) => !(aiOff() && t === 'Hỏi giá')).map((t) => [t, t])]),
    select('f-channel', 'Kênh', '', [['', 'Mọi kênh'], ['zalo', 'Zalo OA']]),
    select('f-kind', 'Loại hình kinh doanh', f.kind, [['', 'Tất cả'], ...KINDS.map((k) => [k, k])]),
    select('f-owner', 'Người phụ trách', f.owner, [['', 'Mọi người'], ['none', 'Chưa có'], ...OWNERS.map((o) => [o, o])]),
    select('f-range', 'Liên hệ cuối', f.range, RANGES),
    f.q || f.tag || f.kind || f.owner || f.range ? h('button', { class: 'btn link', onclick: () => { for (const k of ['q', 'tag', 'kind', 'owner', 'range']) Proto.set(k, ''); } }, 'Xóa bộ lọc') : null);
}

function mergeBar(selected) {
  if (!can(['owner', 'admin', 'manager'])) return null;
  return h('div', { class: 'row', role: 'status' },
    h('span', { class: 'small' }, `Đã chọn ${selected.length}`),
    h('button', { class: 'btn', disabled: selected.length !== 2, onclick: () => Proto.toast('Mở #9 Gộp khách: so sánh 2 hồ sơ, chọn giá trị giữ lại. Ghi audit.') }, 'So sánh và gộp 2 khách'),
    selected.length > 2 ? h('span', { class: 'small muted' }, 'Gộp từng cặp một.') : null);
}

function table(rows) {
  const selected = Proto.get('sel', '').split(',').filter(Boolean);
  const toggle = (id) => Proto.set('sel', (selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id]).join(','));
  const merging = can(['owner', 'admin', 'manager']);
  return h('div', { class: 'stack' },
    h('p', { class: 'small muted', role: 'status' }, `${rows.length} khách`),
    mergeBar(selected),
    h('table', { class: 'plain' },
      h('thead', {}, h('tr', {}, [merging ? h('span', { class: 'sr-only' }, 'Chọn') : null, 'Khách', 'SĐT', 'Kênh', 'Tag', 'Loại hình', 'Phụ trách', 'Liên hệ cuối'].filter((c) => c !== null).map((c) => h('th', {}, c)))),
      h('tbody', {}, rows.map((c) => h('tr', {},
        merging ? h('td', {}, h('input', { type: 'checkbox', checked: selected.includes(c.id), onchange: () => toggle(c.id), 'aria-label': `Chọn ${c.name}` })) : null,
        h('td', {}, h('a', { href: `customer.html?role=${Proto.role()}` }, c.name), h('div', { class: 'small muted' }, c.company)),
        h('td', {}, c.phone ? Proto.maskPhone(c.phone) : h('span', { class: 'small muted' }, 'Chưa có')),
        h('td', {}, c.channels.join(', ')),
        h('td', {}, c.tags.filter((t) => !(aiOff() && c.aiTag && t === 'Hỏi giá')).map((t) => h('span', { class: 'badge' }, t))),
        h('td', {}, c.kind ?? h('span', { class: 'small muted' }, '—')),
        h('td', {}, c.owner ?? h('span', { class: 'small muted' }, 'Chưa có')),
        h('td', {}, c.last))))));
}

Proto.mount({
  page: 'customers',
  states: [['normal', 'Bình thường'], ['loading', 'Đang tải'], ['empty', 'Trống'], ['error', 'Lỗi'], ['aioff', 'AI tắt']],
  render: () => {
    if (Proto.role() === 'platform_operator' && Proto.get('shell', 'normal') !== 'platform_session') {
      return h('div', { class: 'page-body' }, Proto.noAccess('Danh sách khách ngoài phiên truy cập có lý do', 'platform.html'));
    }
    const f = { q: Proto.get('q', ''), tag: Proto.get('tag', ''), kind: Proto.get('kind', ''), owner: Proto.get('owner', ''), range: Proto.get('range', '') };
    const s = Proto.state();
    let body;
    if (s === 'loading') body = Proto.loading(6);
    else if (s === 'error') body = Proto.error('Không tải được danh sách khách.');
    else if (s === 'empty') body = Proto.empty('Chưa có khách nào. Khách tự xuất hiện khi nhắn qua kênh đã kết nối.', can(['owner', 'admin']) ? 'Nhập khách từ file' : null, () => Proto.toast('Mở #10 Nhập khách từ file.'));
    else {
      const rows = CUSTOMERS.filter((c) => matches(c, f));
      body = rows.length ? table(rows) : h('div', { class: 'state-box' }, h('p', {}, 'Không có khách khớp bộ lọc.'), h('button', { class: 'btn', onclick: () => { for (const k of ['q', 'tag', 'kind', 'owner', 'range']) Proto.set(k, ''); } }, 'Xóa bộ lọc'));
    }
    const masked = !Proto.can('customer.phone.full');
    return h('div', { class: 'main' },
      h('div', { class: 'page-head' },
        h('div', {}, h('h1', {}, 'Khách hàng'), h('p', { class: 'small muted' }, 'Công ty Gani Foods · hồ sơ dùng chung mọi workspace. ', masked ? 'Vai trò của bạn thấy SĐT dạng che. ' : '', h('span', { class: 'pending-spec' }, 'cột và bộ lọc theo spec M8; Brief UI §6.1 chưa có trong repo'))),
        can(['owner', 'admin']) ? h('div', { class: 'row' },
          h('button', { class: 'btn', onclick: () => Proto.toast('Xuất CSV theo bộ lọc hiện tại; SĐT đầy đủ, ghi audit (Phụ lục B: Owner, Admin).') }, 'Xuất CSV'),
          h('button', { class: 'btn primary', onclick: () => Proto.toast('Mở #10 Nhập khách từ file (3 bước).') }, 'Nhập từ file')) : null),
      aiOff() ? h('div', { class: 'banner info', role: 'note' }, 'AI đang tắt: tag do AI gắn không hiện trong danh sách và bộ lọc; tag gắn tay dùng bình thường.') : null,
      h('div', { class: 'page-body stack' },
        s === 'normal' || s === 'aioff' ? h('div', { class: 'card' }, filters(f)) : null,
        h('div', { class: 'card', style: 'overflow:auto' }, body)));
  },
});
