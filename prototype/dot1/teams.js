/* global Proto */
/* #20 Team (danh-sach-man-M11; A4). Sprint S4, nộp wireframe 21/12/2026.
   Căn cứ: spec M8 §3.1 (tạo team, thêm/bớt thành viên — một người ở nhiều team, team mặc định, team phụ trách kênh; xóa team mặc định
   hay đang phụ trách kênh bị chặn, báo lý do). Owner, Admin xem và sửa; Manager xem team của mình (spec M8, Phụ lục B: sửa chỉ
   Owner/Admin). Danh sách team, team mặc định và liên kết kênh là dữ liệu tạm, chờ Q7 (U18, U20-6). */
const { h } = Proto;

const PEOPLE = [['u3', 'Hà Linh', 'Manager'], ['u4', 'Trần Thu', 'Sales'], ['u5', 'Đặng Mai', 'Support'], ['u7', 'Lê Quân', 'Sales']];
const CHANNELS = [['ch1', 'Zalo OA Gani Foods B2B'], ['ch2', 'Zalo OA Gani Foods Sỉ miền Nam']];
const TEAMS = [
  { id: 't1', name: 'Sales B2B', desc: 'Khách sỉ, nhà phân phối', members: ['u3', 'u4'], channels: ['ch1'], isDefault: true },
  { id: 't2', name: 'Sales miền Nam', desc: 'Đại lý phía Nam', members: ['u4', 'u7'], channels: ['ch2'], isDefault: false },
  { id: 't3', name: 'CSKH', desc: 'Sau bán hàng, khiếu nại', members: ['u5'], channels: [], isDefault: false },
];
/* Manager Hà Linh (u3) chỉ thấy team mình ở trong. */
const MANAGER_ID = 'u3';

const canEdit = () => ['owner', 'admin'].includes(Proto.role());
const pending = (text) => h('span', { class: 'pending-spec' }, text);
const person = (id) => PEOPLE.find(([pid]) => pid === id);
const channelName = (id) => CHANNELS.find(([cid]) => cid === id)?.[1];
const ownerOf = (channelId) => TEAMS.find((t) => t.channels.includes(channelId));

function createTeam() {
  const name = h('input', { id: 'team-name', class: 'input', maxlength: 60, autofocus: true });
  const desc = h('input', { id: 'team-desc', class: 'input', maxlength: 200 });
  const err = h('p', { class: 'field-error', role: 'alert' });
  Proto.dialog('Tạo team', h('div', { class: 'stack' },
    h('div', { class: 'field' }, h('label', { for: 'team-name' }, 'Tên team'), name),
    h('div', { class: 'field' }, h('label', { for: 'team-desc' }, 'Mô tả (không bắt buộc)'), desc),
    h('p', { class: 'small muted' }, 'Thêm thành viên và kênh sau khi tạo.'),
    err), (close) => [
    h('button', { class: 'btn', onclick: close }, 'Hủy'),
    h('button', { class: 'btn primary', onclick: (e) => {
      const value = name.value.trim();
      if (!value) { err.textContent = 'Nhập tên team.'; name.focus(); return; }
      if (TEAMS.some((t) => t.name.toLowerCase() === value.toLowerCase())) { err.textContent = 'Workspace đã có team tên này.'; name.focus(); return; }
      Proto.serverAction(e.currentTarget, 'Tạo team', () => { close(); Proto.toast(`Đã tạo team ${value}. Ghi audit.`); });
    } }, 'Tạo team'),
  ]);
}

function editMembers(team) {
  const boxes = PEOPLE.map(([id, name, role]) => h('label', { class: 'row' },
    h('input', { type: 'checkbox', checked: team.members.includes(id) }), `${name} · ${role}`,
    TEAMS.some((t) => t !== team && t.members.includes(id)) ? h('span', { class: 'small muted' }, ` (cũng ở ${TEAMS.filter((t) => t !== team && t.members.includes(id)).map((t) => t.name).join(', ')})`) : null));
  Proto.dialog(`Thành viên — ${team.name}`, h('div', { class: 'stack' },
    h('fieldset', { class: 'stack' }, h('legend', {}, 'Người trong team'), boxes),
    h('p', { class: 'small muted' }, 'Một người có thể ở nhiều team. Chỉ Manager, Sales, Support đang hoạt động; mời người mới ở Cài đặt › Thành viên.')), (close) => [
    h('button', { class: 'btn', onclick: close }, 'Hủy'),
    h('button', { class: 'btn primary', onclick: (e) => Proto.serverAction(e.currentTarget, 'Lưu', () => { close(); Proto.toast(`Đã lưu thành viên của ${team.name}. Hội thoại đang xử lý không đổi người phụ trách. Ghi audit.`); }) }, 'Lưu'),
  ]);
}

function editChannels(team) {
  const boxes = CHANNELS.map(([id, name]) => {
    const owner = ownerOf(id);
    return h('label', { class: 'row' }, h('input', { type: 'checkbox', checked: owner === team }), name,
      owner && owner !== team ? h('span', { class: 'small muted' }, ` (đang thuộc ${owner.name}, chọn thì chuyển sang ${team.name})`) : null);
  });
  Proto.dialog(`Kênh phụ trách — ${team.name}`, h('div', { class: 'stack' },
    h('fieldset', { class: 'stack' }, h('legend', {}, 'Kênh của workspace'), boxes),
    h('p', { class: 'small muted' }, 'Mỗi kênh do một team phụ trách: hội thoại mới từ kênh đó vào hàng chờ của team. Kênh không có team thì vào team mặc định.')), (close) => [
    h('button', { class: 'btn', onclick: close }, 'Hủy'),
    h('button', { class: 'btn primary', onclick: (e) => Proto.serverAction(e.currentTarget, 'Lưu', () => { close(); Proto.toast(`Đã lưu kênh của ${team.name}. Áp dụng cho hội thoại mới. Ghi audit.`); }) }, 'Lưu'),
  ]);
}

function removeTeam(team) {
  const reasons = [
    team.isDefault ? 'Đây là team mặc định của workspace: đặt team khác làm mặc định trước.' : null,
    team.channels.length ? `Team đang phụ trách kênh ${team.channels.map(channelName).join(', ')}: chuyển kênh sang team khác trước.` : null,
  ].filter(Boolean);
  if (reasons.length) {
    Proto.dialog(`Chưa xóa được ${team.name}`, h('ul', {}, reasons.map((r) => h('li', {}, r))), (close) => [h('button', { class: 'btn primary', onclick: close }, 'Đã hiểu')]);
    return;
  }
  Proto.dialog(`Xóa team ${team.name}?`, h('p', {}, `${team.members.length} thành viên rời team, tài khoản của họ giữ nguyên. Hội thoại đang xử lý giữ người phụ trách.`), (close) => [
    h('button', { class: 'btn', onclick: close }, 'Hủy'),
    h('button', { class: 'btn primary', onclick: (e) => Proto.serverAction(e.currentTarget, 'Xóa team', () => { close(); Proto.toast(`Đã xóa team ${team.name}. Ghi audit.`); }) }, 'Xóa team'),
  ]);
}

function actions(team) {
  if (!canEdit()) return h('span', { class: 'small muted' }, 'Chỉ xem');
  return h('div', { class: 'row' },
    h('button', { class: 'btn', onclick: () => editMembers(team), 'aria-label': `Thành viên của ${team.name}` }, 'Thành viên'),
    h('button', { class: 'btn', onclick: () => editChannels(team), 'aria-label': `Kênh của ${team.name}` }, 'Kênh'),
    team.isDefault ? null : h('button', { class: 'btn', onclick: () => Proto.toast(`${team.name} là team mặc định: nhận hội thoại khi chưa có quy tắc khác. Ghi audit.`), 'aria-label': `Đặt ${team.name} làm mặc định` }, 'Đặt mặc định'),
    h('button', { class: 'btn', onclick: () => removeTeam(team), 'aria-label': `Xóa ${team.name}` }, 'Xóa'));
}

function table() {
  const teams = canEdit() ? TEAMS : TEAMS.filter((t) => t.members.includes(MANAGER_ID));
  return h('table', { class: 'plain' },
    h('thead', {}, h('tr', {}, ['Team', 'Thành viên', 'Kênh phụ trách', ''].map((t) => h('th', {}, t || h('span', { class: 'sr-only' }, 'Thao tác'))))),
    h('tbody', {}, teams.map((t) => h('tr', {},
      h('td', {}, h('div', {}, t.name, ' ', t.isDefault ? h('span', { class: 'badge ok' }, 'Mặc định') : null), h('div', { class: 'small muted' }, t.desc)),
      h('td', {}, t.members.map((id) => person(id)[1]).join(', ')),
      h('td', {}, t.channels.length ? t.channels.map(channelName).join(', ') : h('span', { class: 'small muted' }, 'Chưa có')),
      h('td', {}, actions(t))))));
}

Proto.mount({
  page: 'teams',
  states: [['normal', 'Bình thường'], ['loading', 'Đang tải'], ['empty', 'Trống'], ['error', 'Lỗi'], ['aioff', 'AI tắt — Không áp dụng']],
  render: () => {
    if (!['owner', 'admin', 'manager'].includes(Proto.role())) {
      return h('div', { class: 'page-body' }, Proto.noAccess('Team (Owner, Admin; Manager xem team của mình)', Proto.can('inbox.view') ? 'inbox.html' : 'customer.html'));
    }
    const s = Proto.state();
    let body;
    if (s === 'loading') body = Proto.loading(4);
    else if (s === 'error') body = Proto.error('Không tải được danh sách team.');
    else if (s === 'empty') body = Proto.empty('Chưa có team.', canEdit() ? 'Tạo team đầu tiên' : null, createTeam);
    else body = table();
    return h('div', { class: 'main' },
      h('div', { class: 'page-head' },
        h('div', {}, h('h1', {}, 'Team'), h('p', { class: 'small muted' }, 'Workspace Gani Foods B2B · ', canEdit() ? 'Tạo, sửa, xóa team đều ghi audit. ' : 'Manager xem team của mình; Owner, Admin sửa. ', pending('team, mặc định, kênh: dữ liệu tạm, chờ Q7'))),
        canEdit() && s !== 'empty' ? h('button', { class: 'btn primary', onclick: createTeam }, 'Tạo team') : null),
      Proto.noAiNote(),
      h('div', { class: 'page-body stack' }, h('div', { class: 'card', style: 'overflow:auto' }, body)));
  },
});
