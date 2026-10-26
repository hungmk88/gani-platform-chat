/* global Proto */
/* Hộp thoại của Hộp thư: Chuyển, Gán lại, Đóng, Chặn spam. Tách khỏi inbox.js (mỗi file ≤ 500 dòng, N126).
   Theo #147 (đang mở): `POST /v1/conversations/{id}/transfer` và `/assign` nhận `{version, toUserId}` (một người),
   `/close` nhận `{version, outcome}`. Người nhận không hợp lệ → 422 `invalid_assignee` (một câu cho mọi lý do);
   phiên bản cũ → 409 `version_conflict`. Chuyển: Sales/Support chỉ chuyển hội thoại của mình, cho người cùng team;
   Manager trở lên chuyển hay gán cho bất kỳ ai trong workspace. Gán lại: chỉ Manager trở lên (Brief backend P14). */
(() => {
  const { h } = Proto;

  // `team: 'Team'` là chuyển cho cả team: API của #147 chỉ nhận một người, chờ U31.
  const PEOPLE = [
    { name: 'Trần Thu', team: 'Sales B2B', recent: true },
    { name: 'Vũ Nam', team: 'Sales B2B', recent: true },
    { name: 'Đặng Mai', team: 'CSKH', recent: false },
    { name: 'Lý Hùng', team: 'CSKH', recent: false },
    { name: 'Team CSKH', team: 'Team', recent: true },
  ];
  const REASONS = ['Cần chuyên môn khác', 'Hết ca làm việc', 'Khách quen của người khác', 'Quá tải'];

  const isTeam = (p) => p.team === 'Team';
  const personLabel = (p) => (isTeam(p) ? `${p.name} (chờ U31)` : p.name);

  function chipGroup(options, selected, onPick, label) {
    return h('div', { class: 'row', role: 'group', 'aria-label': label }, options.map((o) => h('button', { class: 'chip', 'aria-pressed': String(o === selected), onclick: (e) => onPick(o, e.currentTarget) }, o)));
  }

  /* Chuyển và Gán lại cùng một kết quả; hai trạng thái lỗi vẽ theo câu trả lời của #147. */
  function handOver(c, person, reason, close, err, verb) {
    const s = Proto.state();
    if (s === 'handover_invalid') { err.textContent = `Không ${verb} được cho ${person}. Chọn người khác.`; return; }
    close();
    if (s === 'handover_conflict') { Proto.toast('Hội thoại vừa thay đổi (có người thao tác trước). Đã tải lại, kiểm tra rồi làm lại.'); Proto.render(); return; }
    c.assignee = person;
    if (c.state === 'HUMAN_WAITING_Q' || (c.state === 'BOT_ACTIVE' && c.hold)) { c.state = 'HUMAN_ACTIVE'; c.hold = false; }
    c.messages.push({ kind: 'system', text: reason ? `Đã ${verb} cho ${person} — lý do: ${reason}` : `Đã ${verb} cho ${person}`, at: 'Vừa xong' });
    Proto.toast(verb === 'chuyển' ? `Đã chuyển cho ${person}. Hội thoại rời khỏi "Của tôi".` : `Đã gán cho ${person}. Ghi audit.`);
    Proto.render();
  }

  function transfer(c) {
    const variant = Proto.get('transfer', 'A');
    let reason = variant === 'A' ? REASONS[0] : null;
    let person = null;
    const body = h('div', { class: 'stack' });
    const err = h('p', { class: 'field-error', role: 'alert' });
    const scope = Proto.isManagerUp() ? null : h('p', { class: 'small muted' }, 'Chỉ chuyển cho người cùng team. ', h('span', { class: 'pending-spec' }, 'danh sách người nhận hợp lệ: chờ U31'));
    const reasonLabel = h('label', {}, 'Lý do (bắt buộc) ', h('span', { class: 'pending-spec' }, 'nơi lưu lý do: chờ N135'));
    const draw = (close) => {
      body.replaceChildren();
      if (variant === 'A') {
        body.append(
          h('p', { class: 'small muted' }, 'Bấm tên người nhận là chuyển luôn (lý do đã chọn sẵn, đổi được).'),
          h('div', { class: 'field' }, reasonLabel, chipGroup(REASONS, reason, (r) => { reason = r; draw(close); }, 'Lý do')),
          h('div', { class: 'field' }, h('label', {}, 'Người nhận — team và gần đây'), h('div', { class: 'row' }, PEOPLE.filter((p) => p.recent).map((p) => h('button', { class: 'chip', onclick: (e) => Proto.serverAction(e.currentTarget, p.name, () => handOver(c, p.name, reason, close, err, 'chuyển')) }, personLabel(p))))),
          scope, err,
          h('button', { class: 'btn link', onclick: () => { close(); Proto.set('transfer', 'B'); transfer(c); } }, 'Tìm người khác…'));
      } else {
        const results = h('div', { class: 'stack', role: 'radiogroup', 'aria-label': 'Người nhận' });
        const reasons = h('div', {});
        const drawResults = (q) => results.replaceChildren(...PEOPLE.filter((p) => p.name.toLowerCase().includes(q.toLowerCase())).map((p) => h('label', { class: 'row' }, h('input', { type: 'radio', name: 'who', checked: person === p.name, onchange: () => { person = p.name; } }), `${personLabel(p)} · ${p.team}`)));
        const drawReasons = () => reasons.replaceChildren(chipGroup(REASONS, reason, (r) => { reason = r; drawReasons(); }, 'Lý do'));
        body.append(
          h('div', { class: 'field' }, h('label', { for: 'who-q' }, 'Tìm người nhận hoặc team'), h('input', { id: 'who-q', class: 'input', autofocus: true, oninput: (e) => drawResults(e.target.value) })),
          results,
          h('div', { class: 'field' }, reasonLabel, reasons),
          scope, err);
        drawResults('');
        drawReasons();
      }
    };
    Proto.dialog(`Chuyển hội thoại — biến thể ${variant}`, body, (close) => {
      draw(close);
      if (variant === 'A') return [h('button', { class: 'btn', onclick: close }, 'Hủy')];
      const confirm = h('button', { class: 'btn primary', onclick: (e) => {
        if (!person || !reason) { Proto.toast('Chọn người nhận và lý do trước.'); return; }
        Proto.serverAction(e.currentTarget, 'Xác nhận', () => handOver(c, person, reason, close, err, 'chuyển'));
      } }, 'Xác nhận');
      return [h('button', { class: 'btn', onclick: close }, 'Hủy'), confirm];
    });
  }

  /* Gán lại (T16 khi có người giữ, T21 khi đang chờ nhận): chỉ Manager trở lên, gán cho một người, ghi audit. */
  function assign(c) {
    let person = null;
    const err = h('p', { class: 'field-error', role: 'alert' });
    const people = PEOPLE.filter((p) => !isTeam(p) && p.name !== c.assignee);
    const body = h('div', { class: 'stack' },
      h('p', { class: 'small muted' }, c.assignee ? `Đang giữ: ${c.assignee}. Gán lại được kể cả khi người đó đang xử lý. Ghi audit.` : 'Hội thoại đang chờ nhận. Gán thẳng cho một người. Ghi audit.'),
      h('div', { class: 'stack', role: 'radiogroup', 'aria-label': 'Người nhận' },
        people.map((p) => h('label', { class: 'row' }, h('input', { type: 'radio', name: 'assign-who', onchange: () => { person = p.name; } }), `${p.name} · ${p.team}`))),
      h('p', { class: 'pending-spec' }, 'danh sách người nhận hợp lệ: chờ U31'),
      err);
    Proto.dialog(c.assignee ? 'Gán lại hội thoại' : 'Gán hội thoại', body, (close) => {
      const confirm = h('button', { class: 'btn primary', onclick: (e) => {
        if (!person) { err.textContent = 'Chọn người nhận trước.'; return; }
        Proto.serverAction(e.currentTarget, 'Gán', () => handOver(c, person, null, close, err, 'gán'));
      } }, 'Gán');
      return [h('button', { class: 'btn', onclick: close }, 'Hủy'), confirm];
    });
  }

  function closeConversation(c) {
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
    Proto.dialog('Đóng hội thoại — chọn kết quả', h('div', { class: 'stack' }, h('p', { class: 'small muted' }, 'Bấm kết quả là đóng luôn.'), h('div', { class: 'field' }, h('label', { for: 'close-note' }, 'Ghi chú (không bắt buộc) ', h('span', { class: 'pending-spec' }, 'nơi lưu: chờ U31')), note)), (close) => [
      ['Đã xong', 'Khách không phản hồi', 'Spam'].map((label) => h('button', { class: 'btn', onclick: (e) => pick(label, e.currentTarget, close) }, label)),
    ]);
  }

  function spam(c) {
    Proto.dialog('Chặn spam?', h('p', {}, `Chặn ${c.name}: hội thoại đóng với kết quả Spam, ghi audit.`), (close) => [
      h('button', { class: 'btn', onclick: close }, 'Hủy'),
      h('button', { class: 'btn primary', onclick: (e) => Proto.serverAction(e.currentTarget, 'Chặn', () => { c.state = 'CLOSED'; close(); Proto.render(); }) }, 'Chặn'),
    ]);
  }

  Proto.inboxDialogs = { PEOPLE, transfer, assign, close: closeConversation, spam };
})();
