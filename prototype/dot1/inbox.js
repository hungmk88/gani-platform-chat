/* global document, Proto, setTimeout */
/* Hộp thư (Brief UI Phần 4). Dữ liệu là mẫu; tên người là giả. */
const { h } = Proto;

const ME = 'Hà Linh';
const STATE_LABEL = {
  BOT_ACTIVE: 'Bot đang xử lý',
  HUMAN_WAITING_Q: 'Chờ nhân viên nhận',
  HUMAN_ACTIVE: 'Nhân viên đang xử lý',
  PENDING_CUSTOMER: 'Chờ khách trả lời',
  CLOSED: 'Đã đóng',
  HOLD: 'Ngoài giờ — chờ đến giờ làm',
};
const PEOPLE = [
  { name: 'Trần Thu', team: 'Sales B2B', recent: true },
  { name: 'Vũ Nam', team: 'Sales B2B', recent: true },
  { name: 'Đặng Mai', team: 'CSKH', recent: false },
  { name: 'Lý Hùng', team: 'CSKH', recent: false },
  { name: 'Team CSKH', team: 'Team', recent: true },
];
const REASONS = ['Cần chuyên môn khác', 'Hết ca làm việc', 'Khách quen của người khác', 'Quá tải'];
const TEMPLATES = [
  { name: 'Chào hỏi', text: 'Chào {{ten_khach}}, em là {{ten_nhan_vien}} từ {{ten_cong_ty}}. Em hỗ trợ được gì ạ?' },
  { name: 'Xin số điện thoại', text: 'Anh/chị cho em xin số điện thoại để bộ phận kinh doanh gọi lại ạ.' },
  { name: 'Hotline', text: 'Anh/chị cần gấp có thể gọi {{sdt_cong_ty}}, em là {{ten_nhan_vien}} ạ.' },
];
const XSS_1 = "<script>alert('xss')</script> cho hỏi giá";
const XSS_2 = '<img src=x onerror=alert(1)>';

function seed() {
  return [
    {
      id: 'c1', name: 'Nguyễn Văn An', company: 'Quán Phở Hà Nội', state: 'HUMAN_WAITING_Q', assignee: null,
      sla: 12, unread: 2, tags: [{ label: 'Hỏi giá', ai: true }], phone: '0900000001', lead: 'Bước 3',
      messages: [
        { kind: 'customer', text: 'Chào shop, bên mình có bánh phở khô loại sỉ không?', at: '09:02' },
        { kind: 'bot', text: 'Dạ có ạ. Anh/chị cho em xin số điện thoại để nhân viên báo giá nhé.', at: '09:02' },
        { kind: 'customer', text: '0900000001', at: '09:03' },
        { kind: 'customer', text: 'Mình cần báo giá trong hôm nay nhé', at: '09:04' },
        { kind: 'system', text: 'Bot chuyển cho nhân viên — lý do: khách hỏi giá sỉ', at: '09:04' },
      ],
    },
    {
      id: 'c2', name: 'Trần Thị Bình', company: 'Đại lý Bình Minh', state: 'HUMAN_ACTIVE', assignee: ME,
      sla: 45, unread: 0, tags: [{ label: 'Đặt hàng', ai: false }], phone: '0900000002', lead: null,
      messages: [
        { kind: 'customer', text: 'Tuần sau giao giúp chị như đơn cũ nhé', at: '08:40' },
        { kind: 'mine', text: 'Dạ em ghi nhận, em kiểm tra lịch giao và báo chị ngay.', at: '08:42', status: 'Kênh đã nhận' },
        { kind: 'note', text: '@Trần Thu kiểm tra giúp lịch xe thứ 3', at: '08:43' },
      ],
    },
    {
      id: 'c3', name: 'Khách Zalo 8812', company: '', state: 'BOT_ACTIVE', assignee: null,
      sla: null, unread: 1, tags: [], phone: null, lead: null,
      messages: [{ kind: 'customer', text: 'Shop ơi', at: '09:10' }, { kind: 'bot', text: 'Chào anh/chị, em là trợ lý tự động. Anh/chị cần hỗ trợ gì ạ?', at: '09:10' }],
    },
    {
      id: 'c4', name: 'Lê Minh', company: 'Nhà hàng Sen', state: 'PENDING_CUSTOMER', assignee: ME,
      sla: null, unread: 0, tags: [], phone: '0900000003', lead: 'Bước 2',
      messages: [{ kind: 'mine', text: 'Em đã gửi báo giá, anh xem giúp em nhé.', at: 'Hôm qua', status: 'Kênh đã nhận' }],
    },
    {
      id: 'c5', name: 'Phạm Hoa', company: '', state: 'HUMAN_WAITING_Q', assignee: null,
      sla: -6, unread: 3, tags: [], phone: '0900000004', lead: null,
      messages: [
        { kind: 'customer', text: XSS_2, at: '08:50' },
        { kind: 'customer', text: XSS_1, at: '08:51' },
        { kind: 'recalled', at: '08:52' },
      ],
    },
    {
      id: 'c6', name: 'Công ty TNHH Minh Phát', company: 'Minh Phát', state: 'HOLD', assignee: null,
      sla: null, unread: 1, tags: [], phone: '0280000002', lead: null,
      messages: [{ kind: 'customer', text: 'Gọi lại cho tôi sáng mai', at: '21:15' }, { kind: 'bot', text: 'Ngoài giờ làm việc. Chúng tôi đã nhận lời nhắn và sẽ gọi lại lúc 8:00.', at: '21:15' }],
    },
    {
      id: 'c7', name: 'Đỗ Quang', company: '', state: 'CLOSED', assignee: ME,
      sla: null, unread: 0, tags: [], phone: '0900000005', lead: null,
      messages: [{ kind: 'system', text: 'Đã đóng — kết quả: Đã xong', at: 'Thứ Hai' }],
    },
  ];
}

// drafts: bản nháp theo hội thoại; app thật lưu ở máy chủ (/v1/me/drafts), không localStorage.
const db = { convs: seed(), selected: null, mode: 'reply', filter: { state: 'all', who: 'all', sla: 'all', q: '' }, rightOpen: false, drafts: {}, composerFocused: false };

function defaultSelected() {
  const s = Proto.state();
  if (['api_closed', 'paid_only', 'send_failed'].includes(s)) return 'c2';
  return 'c1';
}
function current() {
  return db.convs.find((c) => c.id === (db.selected || defaultSelected())) || db.convs[0];
}
function windowState() {
  const s = Proto.state();
  return s === 'api_closed' || s === 'paid_only' ? s : 'open';
}
function canAct(c) {
  // Sales/Support chỉ đóng/chuyển hội thoại của mình (Phụ lục B "Mình").
  return Proto.isManagerUp() || c.assignee === ME;
}
function isClaimable(c) {
  return c.state === 'HUMAN_WAITING_Q' || c.state === 'HOLD';
}
function stateBadge(c) {
  const cls = c.state === 'HUMAN_WAITING_Q' ? 'warn' : c.state === 'CLOSED' ? '' : c.state === 'HUMAN_ACTIVE' ? 'ok' : 'outline';
  return h('span', { class: `badge ${cls}` }, STATE_LABEL[c.state]);
}
function slaBadge(c) {
  if (c.sla === null) return null;
  if (c.sla < 0) return h('span', { class: 'badge error', title: 'Quá hạn SLA' }, `Quá ${-c.sla} phút`);
  return h('span', { class: `badge ${c.sla < 15 ? 'error' : 'ok'}`, title: 'Còn lại trước hạn SLA' }, `Còn ${c.sla} phút`);
}
function lastText(c) {
  const m = [...c.messages].reverse().find((x) => x.text);
  return m ? m.text : '';
}

/* ---------- Cột trái ---------- */
function visibleConvs() {
  const f = db.filter;
  return db.convs.filter((c) => {
    if (f.state !== 'all' && c.state !== f.state) return false;
    if (f.who === 'mine' && c.assignee !== ME) return false;
    if (f.who === 'none' && c.assignee !== null) return false;
    if (f.sla === 'soon' && !(c.sla !== null && c.sla >= 0 && c.sla < 15)) return false;
    if (f.sla === 'over' && !(c.sla !== null && c.sla < 0)) return false;
    if (f.q && !`${c.name} ${c.phone || ''}`.toLowerCase().includes(f.q.toLowerCase())) return false;
    return true;
  });
}
function filterSelect(label, key, options) {
  return h('div', { class: 'field' }, h('label', { for: `f-${key}` }, label), h('select', { id: `f-${key}`, class: 'input', onchange: (e) => { db.filter[key] = e.target.value; Proto.render(); } }, options.map(([v, t]) => h('option', { value: v, selected: db.filter[key] === v }, t))));
}
function leftColumn() {
  const s = Proto.state();
  const whoOptions = [['all', Proto.isManagerUp() ? 'Tất cả' : 'Của tôi + chưa ai nhận + team'], ['mine', 'Của tôi'], ['none', 'Chưa ai nhận'], ['team', 'Team của tôi']];
  const active = db.convs.filter((c) => c.assignee === ME && c.state === 'HUMAN_ACTIVE').length + (s === 'overload' ? 4 : 3);
  const pending = db.convs.filter((c) => c.assignee === ME && c.state === 'PENDING_CUSTOMER').length + 2;
  let list;
  if (s === 'loading') list = h('div', { style: 'padding:var(--sp-3)' }, Proto.loading(8));
  else if (s === 'error') list = Proto.error('Không tải được danh sách hội thoại.');
  else if (s === 'empty') list = Proto.empty(['owner', 'admin'].includes(Proto.role()) ? 'Chưa có hội thoại.' : 'Chưa có hội thoại nào giao cho bạn.', ['owner', 'admin'].includes(Proto.role()) ? 'Kết nối Zalo OA' : 'Xem hội thoại chưa ai nhận', () => Proto.toast('Mở màn kênh Zalo / bộ lọc "Chưa ai nhận".'));
  else {
    const items = visibleConvs();
    list = items.length
      ? h('ul', { class: 'conv-list', 'aria-label': 'Danh sách hội thoại' }, items.map((c) => h('li', {}, h('button', { class: 'conv', 'aria-current': String(c.id === current().id), onclick: () => select(c.id) },
          h('span', { class: 'row' }, h('span', { class: 'badge outline', title: 'Kênh' }, 'Zalo'), h('strong', {}, c.name)),
          h('span', { class: 'small muted' }, c.messages.length ? c.messages[c.messages.length - 1].at : ''),
          h('span', { class: 'last' }, lastText(c)),
          c.unread ? h('span', { class: 'unread', 'aria-label': `${c.unread} tin chưa đọc` }, String(c.unread)) : h('span', {}),
          h('span', { class: 'row' }, stateBadge(c), slaBadge(c)), h('span', {})))))
      : Proto.empty('Không có hội thoại khớp bộ lọc.', 'Xóa bộ lọc', () => { db.filter = { state: 'all', who: 'all', sla: 'all', q: '' }; Proto.render(); });
  }
  return h('section', { class: 'col-left', 'aria-label': 'Bộ lọc và danh sách' },
    h('div', { class: 'filters' },
      h('div', { class: 'field full' }, h('label', { for: 'search' }, 'Tìm theo tên, SĐT (phím /)'), h('input', { id: 'search', class: 'input', type: 'search', value: db.filter.q, oninput: (e) => { db.filter.q = e.target.value; Proto.render(); document.getElementById('search').focus(); } })),
      filterSelect('Trạng thái', 'state', [['all', 'Tất cả'], ...Object.entries(STATE_LABEL)]),
      filterSelect('Người phụ trách', 'who', whoOptions),
      filterSelect('SLA', 'sla', [['all', 'Tất cả'], ['soon', 'Sắp quá hạn'], ['over', 'Quá hạn']]),
      h('div', { class: 'field' }, h('label', { for: 'f-ch' }, 'Kênh'), h('select', { id: 'f-ch', class: 'input' }, h('option', {}, 'Zalo OA'))),
      h('div', { class: 'field' }, h('label', { for: 'f-tag' }, 'Tag'), h('select', { id: 'f-tag', class: 'input' }, h('option', {}, 'Tất cả'), h('option', {}, 'Hỏi giá'), h('option', {}, 'Đặt hàng'))),
      h('div', { class: 'field' }, h('label', { for: 'f-sort' }, 'Sắp xếp'), h('select', { id: 'f-sort', class: 'input' }, h('option', {}, 'Mới nhất'), h('option', {}, 'SLA gần nhất'), h('option', {}, 'Chưa đọc trước')))),
    h('div', { class: 'agent-load spread' }, h('span', {}, 'Tải của bạn: ', h('strong', {}, `Đang xử lý ${active}/5`), ` · Chờ khách ${pending}`), active >= 5 ? h('span', { class: 'badge warn' }, 'Đủ giới hạn') : null),
    list);
}

function select(id) {
  db.selected = id;
  const c = current();
  c.unread = 0;
  Proto.render();
}

/* ---------- Cột giữa ---------- */
function handoffCard(c) {
  if (!c.messages.some((m) => m.kind === 'system' && m.text.startsWith('Bot chuyển'))) return null;
  const aiOff = Proto.state() === 'aioff';
  return h('details', { class: 'handoff', open: true },
    h('summary', {}, aiOff ? 'Dữ liệu bot đã thu' : 'Tóm tắt khi chuyển người'),
    h('div', { class: 'body stack' },
      aiOff
        ? h('dl', { class: 'kv' }, h('dt', {}, 'Tên'), h('dd', {}, c.name), h('dt', {}, 'SĐT'), h('dd', {}, c.phone ? Proto.maskPhone(c.phone) : '—'), h('dt', {}, 'Nhu cầu đã chọn'), h('dd', {}, 'Hỏi giá sỉ'), h('dt', {}, '3 tin cuối'), h('dd', {}, c.messages.filter((m) => m.kind === 'customer').slice(-3).map((m) => h('div', {}, `“${m.text}”`))))
        : [h('p', {}, 'Khách hỏi giá sỉ bánh phở khô, đã để lại SĐT, muốn nhận báo giá trong hôm nay.'), h('p', { class: 'small muted' }, 'Tóm tắt do AI viết (L1) — chỉ nội bộ, không gửi khách.')]));
}

function messageNode(m, c) {
  const supported = Proto.get('o7', 'yes') === 'yes';
  if (m.kind === 'recalled') return supported ? h('div', { class: 'msg system' }, 'Khách đã thu hồi tin') : null;
  const label = { bot: 'Bot', other: m.by, note: 'Nội bộ — khách không thấy' }[m.kind];
  let meta = m.at;
  if (m.kind === 'mine') meta = `${m.at} · ${m.status === 'Đã xem' && !supported ? 'Kênh đã nhận' : m.status}`;
  return h('div', { class: `msg ${m.kind}${m.status === 'Lỗi' ? ' failed' : ''}` },
    label ? h('strong', { class: 'small', style: 'display:block' }, label) : null,
    m.text,
    h('span', { class: 'meta' }, meta),
    m.status === 'Lỗi' ? h('span', { class: 'row', style: 'margin-top:var(--sp-1)' }, h('span', { class: 'badge error' }, 'Gửi lỗi'), h('button', { class: 'btn', onclick: () => resend(m, c) }, 'Gửi lại')) : null,
    m.kind === 'customer' && supported ? h('button', { class: 'btn link small', onclick: () => Proto.toast('Trả lời trích dẫn là C24, Đợt 2 — vẽ để chốt O7.') }, 'Trích dẫn (Đợt 2)') : null);
}

function resend(m, c) {
  m.status = 'Đang gửi'; // dùng lại Idempotency-Key cũ
  Proto.render();
  progress(m, c);
}
function progress(m) {
  const steps = ['Đã tới hệ thống', 'Kênh đã nhận'];
  if (Proto.get('o7', 'yes') === 'yes') steps.push('Đã xem');
  steps.forEach((s, i) => setTimeout(() => { m.status = s; Proto.render(); }, 500 * (i + 1)));
}

function headerActions(c) {
  if (isClaimable(c)) {
    const over = Proto.state() === 'overload';
    return [over ? h('span', { class: 'badge warn' }, 'Bạn đang xử lý 5/5 — vẫn nhận được') : null,
      Proto.can('inbox.spam') ? h('button', { class: 'btn', onclick: () => spamDialog(c) }, 'Chặn spam') : null,
      Proto.can('inbox.claim') ? h('button', { class: 'btn primary', id: 'claim', onclick: (e) => claim(c, e.currentTarget) }, 'Nhận ', h('span', { class: 'kbd' }, 'A')) : null];
  }
  if (c.state === 'HUMAN_ACTIVE' || c.state === 'PENDING_CUSTOMER') {
    if (!canAct(c)) return [h('span', { class: 'muted small' }, 'Đồng nghiệp đang xử lý')];
    return [
      c.state === 'HUMAN_ACTIVE' ? h('button', { class: 'btn', onclick: () => { c.state = 'PENDING_CUSTOMER'; c.messages.push({ kind: 'system', text: 'Chuyển sang Chờ khách trả lời', at: 'Vừa xong' }); Proto.render(); } }, 'Chờ khách') : null,
      h('button', { class: 'btn', onclick: () => transferDialog(c) }, 'Chuyển ', h('span', { class: 'kbd' }, 'T')),
      h('button', { class: 'btn', onclick: () => closeDialog(c) }, 'Đóng ', h('span', { class: 'kbd' }, 'E')),
    ];
  }
  if (c.state === 'BOT_ACTIVE') return [h('span', { class: 'muted small' }, 'Bot đang xử lý — chưa cần người')];
  return [h('span', { class: 'muted small' }, 'Khách nhắn trong 72 giờ sẽ mở lại hội thoại này')];
}

function claim(c, button) {
  Proto.serverAction(button, 'Nhận', () => {
    if (Proto.state() === 'claimed') {
      c.assignee = 'Trần Thu';
      c.state = 'HUMAN_ACTIVE';
      Proto.toast('Đã được Trần Thu nhận. Hội thoại được bỏ khỏi danh sách chờ.');
      db.selected = db.convs.find((x) => isClaimable(x) && x.id !== c.id)?.id || 'c2';
    } else {
      c.assignee = ME;
      c.state = 'HUMAN_ACTIVE';
      c.messages.push({ kind: 'system', text: 'Bạn đã nhận hội thoại', at: 'Vừa xong' });
    }
    Proto.render();
  });
}

function chipGroup(options, selected, onPick, label) {
  return h('div', { class: 'row', role: 'group', 'aria-label': label }, options.map((o) => h('button', { class: 'chip', 'aria-pressed': String(o === selected), onclick: (e) => onPick(o, e.currentTarget) }, o)));
}

function doTransfer(c, person, reason, close) {
  c.assignee = person;
  c.messages.push({ kind: 'system', text: `Đã chuyển cho ${person} — lý do: ${reason}`, at: 'Vừa xong' });
  close();
  Proto.toast(`Đã chuyển cho ${person}. Hội thoại rời khỏi "Của tôi".`);
  Proto.render();
}

function transferDialog(c) {
  const variant = Proto.get('transfer', 'A');
  let reason = variant === 'A' ? REASONS[0] : null;
  let person = null;
  const body = h('div', { class: 'stack' });
  const draw = (close) => {
    body.replaceChildren();
    if (variant === 'A') {
      body.append(
        h('p', { class: 'small muted' }, 'Bấm tên người nhận là chuyển luôn (lý do đã chọn sẵn, đổi được).'),
        h('div', { class: 'field' }, h('label', {}, 'Lý do (bắt buộc)'), chipGroup(REASONS, reason, (r) => { reason = r; draw(close); }, 'Lý do')),
        h('div', { class: 'field' }, h('label', {}, 'Người nhận — team và gần đây'), h('div', { class: 'row' }, PEOPLE.filter((p) => p.recent).map((p) => h('button', { class: 'chip', onclick: (e) => Proto.serverAction(e.currentTarget, p.name, () => doTransfer(c, p.name, reason, close)) }, p.name)))),
        h('button', { class: 'btn link', onclick: () => { close(); Proto.set('transfer', 'B'); transferDialog(c); } }, 'Tìm người khác…'));
    } else {
      const results = h('div', { class: 'stack', role: 'radiogroup', 'aria-label': 'Người nhận' });
      const reasons = h('div', {});
      const drawResults = (q) => results.replaceChildren(...PEOPLE.filter((p) => p.name.toLowerCase().includes(q.toLowerCase())).map((p) => h('label', { class: 'row' }, h('input', { type: 'radio', name: 'who', checked: person === p.name, onchange: () => { person = p.name; } }), `${p.name} · ${p.team}`)));
      const drawReasons = () => reasons.replaceChildren(chipGroup(REASONS, reason, (r) => { reason = r; drawReasons(); }, 'Lý do'));
      body.append(
        h('div', { class: 'field' }, h('label', { for: 'who-q' }, 'Tìm người nhận hoặc team'), h('input', { id: 'who-q', class: 'input', autofocus: true, oninput: (e) => drawResults(e.target.value) })),
        results,
        h('div', { class: 'field' }, h('label', {}, 'Lý do (bắt buộc)'), reasons));
      drawResults('');
      drawReasons();
    }
  };
  Proto.dialog(`Chuyển hội thoại — biến thể ${variant}`, body, (close) => {
    draw(close);
    if (variant === 'A') return [h('button', { class: 'btn', onclick: close }, 'Hủy')];
    const confirm = h('button', { class: 'btn primary', onclick: (e) => {
      if (!person || !reason) { Proto.toast('Chọn người nhận và lý do trước.'); return; }
      Proto.serverAction(e.currentTarget, 'Xác nhận', () => doTransfer(c, person, reason, close));
    } }, 'Xác nhận');
    return [h('button', { class: 'btn', onclick: close }, 'Hủy'), confirm];
  });
}

function closeDialog(c) {
  const note = h('textarea', { class: 'input', rows: 2, id: 'close-note' });
  const pick = (label, button, close) => Proto.serverAction(button, label, () => {
    c.state = 'CLOSED';
    c.messages.push({ kind: 'system', text: `Đã đóng — kết quả: ${label}`, at: 'Vừa xong' });
    close();
    Proto.render();
    if (c.lead) {
      Proto.dialog('Cập nhật lead?', h('p', {}, `Khách có lead đang mở ở "${c.lead}" (tên tạm). Đóng hội thoại không đổi trạng thái lead.`), (close2) => [
        h('button', { class: 'btn', onclick: close2 }, 'Để sau'),
        h('a', { class: 'btn primary', href: `leads.html?role=${Proto.role()}` }, 'Mở pipeline lead'),
      ]);
    }
  });
  Proto.dialog('Đóng hội thoại — chọn kết quả', h('div', { class: 'stack' }, h('p', { class: 'small muted' }, 'Bấm kết quả là đóng luôn.'), h('div', { class: 'field' }, h('label', { for: 'close-note' }, 'Ghi chú (không bắt buộc)'), note)), (close) => [
    ['Đã xong', 'Khách không phản hồi', 'Spam'].map((label) => h('button', { class: 'btn', onclick: (e) => pick(label, e.currentTarget, close) }, label)),
  ]);
}

function spamDialog(c) {
  Proto.dialog('Chặn spam?', h('p', {}, `Chặn ${c.name}: hội thoại đóng với kết quả Spam, ghi audit.`), (close) => [
    h('button', { class: 'btn', onclick: close }, 'Hủy'),
    h('button', { class: 'btn primary', onclick: (e) => Proto.serverAction(e.currentTarget, 'Chặn', () => { c.state = 'CLOSED'; close(); Proto.render(); }) }, 'Chặn'),
  ]);
}

/* Ô soạn tin (§4.5) */
function fillTemplate(text, c) {
  const values = { ten_khach: c.name.startsWith('Khách Zalo') ? null : c.name, ten_nhan_vien: ME, ten_cong_ty: 'Gani Foods', sdt_cong_ty: null };
  return text.replace(/\{\{(\w+)\}\}/g, (all, key) => values[key] || all);
}

function composer(c) {
  const ws = windowState();
  if (!canAct(c) || !['HUMAN_ACTIVE', 'PENDING_CUSTOMER'].includes(c.state)) {
    return h('div', { class: 'composer muted small' }, isClaimable(c) ? 'Nhận hội thoại để trả lời (phím A).' : 'Không trả lời được ở trạng thái này.');
  }
  if (ws === 'api_closed' && db.mode === 'reply') {
    return h('div', { class: 'composer' }, h('div', { class: 'locked stack' },
      h('p', {}, 'Hết khung gửi tin Zalo cho hội thoại này — tin thường không gửi được.'),
      h('div', { class: 'row' },
        h('button', { class: 'btn primary', onclick: () => Proto.toast('Mở danh sách mẫu ZNS đã duyệt.') }, 'Gửi ZNS mẫu đã duyệt'),
        h('button', { class: 'btn', onclick: () => Proto.toast(`Gọi ${Proto.maskPhone(c.phone)}`) }, 'Gọi điện'),
        h('button', { class: 'btn', onclick: () => Proto.toast('Đã tạo task gọi lại khách.') }, 'Tạo task')),
      h('button', { class: 'btn link small', onclick: () => { db.mode = 'note'; Proto.render(); } }, 'Viết ghi chú nội bộ')));
  }
  const area = h('textarea', { id: 'composer', class: 'input', rows: 2, 'aria-label': db.mode === 'note' ? 'Ghi chú nội bộ' : 'Soạn tin trả lời', placeholder: db.mode === 'note' ? 'Ghi chú nội bộ — gõ @ để gọi đồng nghiệp' : 'Gõ tin, / để mở mẫu trả lời nhanh' });
  area.value = db.drafts[c.id] || '';
  area.addEventListener('focus', () => { db.composerFocused = true; });
  area.addEventListener('blur', () => { db.composerFocused = false; });
  const help = h('div', {});
  const draft = h('span', { class: 'small muted' }, 'Nháp lưu trên máy chủ');
  const sendBtn = h('button', { class: 'btn primary', onclick: () => send() }, db.mode === 'note' ? 'Lưu ghi chú' : 'Gửi');
  const refresh = () => {
    db.drafts[c.id] = area.value;
    area.style.height = 'auto';
    area.style.height = `${area.scrollHeight}px`;
    help.replaceChildren();
    const blanks = area.value.match(/\{\{\w+\}\}/g);
    if (blanks) help.append(h('p', { class: 'small' }, h('span', { class: 'var-blank' }, `Cần điền: ${blanks.join(', ')}`), ' — không bao giờ gửi {{…}} ra khách.'));
    sendBtn.disabled = Boolean(blanks) || !area.value.trim();
    if (area.value === '/' && db.mode === 'reply') help.append(h('ul', { class: 'template-list', 'aria-label': 'Mẫu trả lời nhanh' }, TEMPLATES.map((t) => h('li', {}, h('button', { onclick: () => { area.value = fillTemplate(t.text, c); refresh(); area.focus(); } }, h('strong', {}, t.name), ' — ', t.text)))));
    if (db.mode === 'note' && area.value.endsWith('@')) help.append(h('div', { class: 'row' }, PEOPLE.slice(0, 4).map((p) => h('button', { class: 'chip', onclick: () => { area.value += `${p.name} `; refresh(); area.focus(); } }, p.name))));
    draft.textContent = area.value ? 'Đang lưu nháp lên máy chủ…' : 'Nháp lưu trên máy chủ';
    if (area.value) setTimeout(() => { draft.textContent = 'Đã lưu nháp'; }, 600);
  };
  const send = () => {
    const text = area.value.trim();
    if (!text || /\{\{\w+\}\}/.test(text)) return;
    db.drafts[c.id] = '';
    if (db.mode === 'note') {
      c.messages.push({ kind: 'note', text, at: 'Vừa xong' });
      Proto.render();
      return;
    }
    const push = () => {
      const m = { kind: 'mine', text, at: 'Vừa xong', status: 'Đang gửi' };
      c.messages.push(m);
      Proto.render();
      if (Proto.state() === 'send_failed') setTimeout(() => { m.status = 'Lỗi'; Proto.render(); }, 500);
      else progress(m, c);
    };
    if (ws === 'paid_only') {
      Proto.dialog('Tin này có phí', h('p', {}, 'Hội thoại đã ra khỏi khung gửi miễn phí. Tin gửi lúc này tính phí theo bảng chính sách kênh.'), (close) => [h('button', { class: 'btn', onclick: close }, 'Hủy'), h('button', { class: 'btn primary', onclick: () => { close(); push(); } }, 'Vẫn gửi')]);
    } else push();
  };
  area.addEventListener('input', refresh);
  area.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    if (e.key === 'Escape') area.blur();
  });
  setTimeout(() => {
    refresh();
    if (db.composerFocused) area.focus();
  });
  return h('div', { class: `composer stack${db.mode === 'note' ? ' note-mode' : ''}` },
    ws === 'paid_only' && db.mode === 'reply' ? h('div', { class: 'banner warn', style: 'border-radius:var(--r-input)' }, 'Ngoài khung miễn phí: tin gửi sẽ có phí.') : null,
    h('div', { class: 'tabs', role: 'tablist' },
      h('button', { role: 'tab', 'aria-selected': String(db.mode === 'reply'), onclick: () => { db.mode = 'reply'; Proto.render(); } }, 'Trả lời khách'),
      h('button', { role: 'tab', 'aria-selected': String(db.mode === 'note'), onclick: () => { db.mode = 'note'; Proto.render(); } }, 'Ghi chú nội bộ ', h('span', { class: 'kbd' }, 'N'))),
    area, help,
    h('div', { class: 'spread' }, h('span', { class: 'row' }, h('button', { class: 'btn', onclick: () => attach(c) }, 'Đính kèm (≤ 10MB)'), draft), sendBtn));
}

function attach(c) {
  const m = { kind: 'mine', text: 'bao-gia.pdf · Đang kiểm tra file…', at: 'Vừa xong', status: 'Đang gửi' };
  c.messages.push(m);
  Proto.render();
  setTimeout(() => { m.text = 'bao-gia.pdf · Đã kiểm tra virus (tải qua link ký 15 phút)'; progress(m, c); Proto.render(); }, 1200);
}

function middleColumn() {
  const s = Proto.state();
  if (s === 'loading') return h('section', { class: 'col-mid', style: 'padding:var(--sp-5)' }, Proto.loading(10));
  if (s === 'error') return h('section', { class: 'col-mid' }, Proto.empty('Chọn lại hội thoại sau khi danh sách tải được.'));
  if (s === 'empty') return h('section', { class: 'col-mid' }, Proto.empty('Hội thoại mới sẽ hiện ở đây.'));
  const c = current();
  return h('section', { class: 'col-mid', 'aria-label': 'Khung hội thoại' },
    h('div', { class: 'conv-head' },
      h('div', {}, h('h1', {}, c.name), h('div', { class: 'row' }, stateBadge(c), slaBadge(c), c.assignee ? h('span', { class: 'small muted' }, `Phụ trách: ${c.assignee}`) : null)),
      h('div', { class: 'row' }, headerActions(c), h('button', { class: 'btn narrow-only', onclick: () => { db.rightOpen = !db.rightOpen; Proto.render(); } }, 'Hồ sơ khách'))),
    handoffCard(c),
    messageList(c),
    composer(c));
}
function messageList(c) {
  const list = h('div', { class: 'messages', 'aria-live': 'polite' }, c.messages.map((m) => messageNode(m, c)));
  setTimeout(() => { list.scrollTop = list.scrollHeight; });
  return list;
}

/* ---------- Cột phải: hồ sơ khách ---------- */
function rightColumn() {
  const s = Proto.state();
  if (['loading', 'error', 'empty'].includes(s)) return h('aside', { class: 'col-right' }, s === 'loading' ? Proto.loading(6) : null);
  const c = current();
  const aiOff = s === 'aioff';
  const tags = c.tags.filter((t) => !(aiOff && t.ai));
  return h('aside', { class: `col-right${db.rightOpen ? ' open' : ''}`, 'aria-label': 'Hồ sơ khách' },
    h('div', { class: 'section' }, h('h2', {}, c.name), c.company ? h('p', { class: 'muted' }, c.company) : null,
      h('dl', { class: 'kv', style: 'margin-top:var(--sp-2)' },
        h('dt', {}, 'Zalo'), h('dd', {}, h('span', { class: 'badge ok' }, 'verified')),
        h('dt', {}, 'SĐT'), h('dd', {}, c.phone ? [`${Proto.maskPhone(c.phone)} `, h('span', { class: 'badge outline' }, 'unverified')] : '—'))),
    h('div', { class: 'section stack' }, h('h3', {}, 'Tag'),
      h('div', { class: 'row' }, tags.map((t) => h('span', { class: 'badge outline' }, t.label, t.ai ? ' · AI gắn' : '', ' ', h('button', { class: 'btn link small', 'aria-label': `Bỏ tag ${t.label}`, onclick: () => { c.tags = c.tags.filter((x) => x !== t); Proto.render(); } }, '×'))),
        h('button', { class: 'btn small', onclick: () => { c.tags.push({ label: 'Khách sỉ', ai: false }); Proto.render(); } }, '+ Tag')),
      aiOff ? h('p', { class: 'small muted' }, 'AI tắt: không tự gắn tag ý định, gắn tay.') : null),
    h('div', { class: 'section stack' }, h('h3', {}, 'Lead'), c.lead ? h('p', {}, `${c.lead} (tên tạm, chờ O1) · đang mở`) : h('p', { class: 'muted' }, 'Chưa có lead'), Proto.can('lead.change') && !c.lead ? h('button', { class: 'btn', onclick: () => { c.lead = 'Bước 1'; Proto.toast('Đã tạo lead từ hội thoại.'); Proto.render(); } }, 'Tạo lead') : null),
    h('div', { class: 'section stack' }, h('h3', {}, 'Ticket'), h('p', { class: 'muted' }, 'Chưa có ticket'), Proto.can('ticket.create') ? h('button', { class: 'btn', onclick: () => Proto.toast('Đã tạo ticket, kèm tóm tắt và link hội thoại.') }, 'Tạo ticket') : null),
    h('div', { class: 'section' }, h('label', { class: 'row' }, h('input', { type: 'checkbox' }), 'Chỉ người phục vụ (khách yêu cầu, §28)')),
    h('a', { class: 'btn link', href: `customer.html?role=${Proto.role()}` }, 'Mở hồ sơ đầy đủ'));
}

/* ---------- Phím tắt (§4.7) ---------- */
document.addEventListener('keydown', (e) => {
  if (document.querySelector('.overlay')) return;
  if (Proto.inTextField(e) || e.ctrlKey || e.metaKey || e.altKey) return;
  const c = current();
  const key = e.key.toLowerCase();
  const actions = {
    a: () => isClaimable(c) && document.getElementById('claim')?.click(),
    r: () => { db.mode = 'reply'; Proto.render(); document.getElementById('composer')?.focus(); },
    n: () => { db.mode = 'note'; Proto.render(); document.getElementById('composer')?.focus(); },
    t: () => canAct(c) && ['HUMAN_ACTIVE', 'PENDING_CUSTOMER'].includes(c.state) && transferDialog(c),
    e: () => canAct(c) && ['HUMAN_ACTIVE', 'PENDING_CUSTOMER'].includes(c.state) && closeDialog(c),
    j: () => step(1),
    k: () => step(-1),
    '/': () => document.getElementById('search')?.focus(),
    '?': () => shortcuts(),
  };
  if (actions[key]) {
    e.preventDefault();
    Proto.countKey();
    actions[key]();
  }
});
function step(delta) {
  const list = visibleConvs();
  const i = list.findIndex((c) => c.id === current().id);
  const next = list[Math.min(list.length - 1, Math.max(0, i + delta))];
  if (next) select(next.id);
}
function shortcuts() {
  const rows = [['A', 'Nhận hội thoại'], ['R', 'Trả lời'], ['T', 'Chuyển'], ['E', 'Đóng'], ['N', 'Ghi chú nội bộ'], ['J / K', 'Hội thoại kế tiếp / trước'], ['/', 'Tìm (ngoài ô soạn) · mẫu trả lời (trong ô soạn)'], ['?', 'Bảng phím tắt'], ['Esc', 'Ra khỏi ô soạn / đóng hộp thoại']];
  Proto.dialog('Phím tắt', h('table', { class: 'plain' }, rows.map(([k, v]) => h('tr', {}, h('td', {}, h('span', { class: 'kbd' }, k)), h('td', {}, v)))), (close) => [h('button', { class: 'btn', onclick: close }, 'Đóng')]);
}

Proto.mount({
  page: 'inbox',
  states: [['normal', 'Bình thường'], ['loading', 'Đang tải'], ['empty', 'Trống'], ['error', 'Lỗi'], ['aioff', 'AI tắt'], ['api_closed', 'Hết khung gửi Zalo'], ['paid_only', 'Ngoài khung miễn phí'], ['send_failed', 'Tin gửi lỗi'], ['claimed', 'Đã được người khác nhận'], ['overload', 'Vượt giới hạn tải']],
  variants: [
    { label: 'Chuyển', name: 'transfer', options: [['A', 'A (2 thao tác)'], ['B', 'B (3 thao tác)']] },
    { label: 'O7 đã xem/thu hồi/trích dẫn', name: 'o7', options: [['yes', 'Kênh hỗ trợ'], ['no', 'Không hỗ trợ']] },
  ],
  render: () => {
    if (!Proto.can('inbox.view')) return Proto.noAccess('Hộp thư (Viewer: Owner bật được cho từng người)', 'customer.html');
    return h('div', { class: 'main', style: 'flex:1;overflow:hidden' }, Proto.aiOffBanner('Admin tắt bằng feature flag'), h('div', { class: 'inbox' }, leftColumn(), middleColumn(), rightColumn()));
  },
});
