/* global Proto */
/* #2 Xác thực 2 lớp (spec M8 bản nháp 3 §3.8, Phụ lục C v3 dòng 6). Không phụ thuộc PR7.
   Better Auth: `/api/auth/two-factor/verify-totp`, `verify-backup-code`; khóa 30 phút sau 5 lần sai. */
const { h } = Proto;

const usedCodes = new Set();
let lastState = null;
let mode = 'totp'; // 'totp' | 'backup'

function backToLogin() {
  return h('a', { class: 'btn link', href: `login.html?role=${Proto.role()}` }, 'Quay lại đăng nhập');
}

function lockedNote() {
  return h('p', { class: 'small muted' }, 'Mất điện thoại và hết mã dự phòng: nhờ Owner hoặc Admin đặt lại 2FA ở Cài đặt › Thành viên.');
}

function totpForm() {
  const s = Proto.state();
  const locked = s === 'locked';
  const code = h('input', { id: 'code', class: 'input', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: '6', disabled: locked });
  const err = h('p', { class: 'field-error', role: 'alert' },
    s === 'wrong' ? 'Mã không đúng hoặc đã hết hạn. Kiểm tra giờ trên điện thoại rồi thử lại.' : '',
    locked ? 'Tạm khóa 30 phút vì nhập sai mã 5 lần.' : '');
  const submit = h('button', { class: 'btn primary', type: 'submit', disabled: locked }, 'Xác nhận');
  if (s === 'loading') {
    submit.setAttribute('aria-busy', 'true');
    submit.disabled = true;
    submit.replaceChildren(h('span', { class: 'spin', 'aria-hidden': 'true' }), 'Đang kiểm tra…');
  }
  return h('form', {
    class: 'stack',
    onsubmit: (e) => {
      e.preventDefault();
      if (!/^\d{6}$/.test(code.value)) { err.textContent = 'Nhập đủ 6 số từ ứng dụng xác thực.'; code.classList.add('invalid'); return; }
      Proto.serverAction(submit, 'Xác nhận', () => Proto.toast('Xác thực xong — vào trang mặc định theo vai trò.'));
    },
  },
  h('p', {}, 'Mở ứng dụng xác thực trên điện thoại và nhập mã 6 số.'),
  h('div', { class: 'field' }, h('label', { for: 'code' }, 'Mã 6 số'), code),
  err,
  submit,
  h('button', { class: 'btn link', type: 'button', disabled: locked, onclick: () => { mode = 'backup'; Proto.render(); } }, 'Dùng mã dự phòng'),
  locked ? lockedNote() : null);
}

function backupForm() {
  const code = h('input', { id: 'backup', class: 'input', autocomplete: 'one-time-code', maxlength: '9', placeholder: 'xxxx-xxxx' });
  const err = h('p', { class: 'field-error', role: 'alert' });
  const submit = h('button', { class: 'btn primary', type: 'submit' }, 'Xác nhận');
  return h('form', {
    class: 'stack',
    onsubmit: (e) => {
      e.preventDefault();
      const value = code.value.trim().toLowerCase();
      if (!/^[a-z0-9]{4}-[a-z0-9]{4}$/.test(value)) { err.textContent = 'Mã dự phòng có dạng xxxx-xxxx.'; code.classList.add('invalid'); return; }
      Proto.serverAction(submit, 'Xác nhận', () => {
        // Mỗi mã dùng 1 lần (Q-U20-2): prototype nhớ mã đã dùng trong trang.
        if (usedCodes.has(value) || !Proto.BACKUP_CODES.includes(value)) {
          err.textContent = 'Mã dự phòng không đúng hoặc đã dùng.';
          code.classList.add('invalid');
          return;
        }
        usedCodes.add(value);
        Proto.toast(`Xác thực xong bằng mã dự phòng. Còn ${Proto.BACKUP_CODES.length - usedCodes.size} mã chưa dùng.`);
      });
    },
  },
  h('p', {}, 'Nhập 1 trong 10 mã dự phòng đã lưu khi bật 2FA. Mỗi mã chỉ dùng được 1 lần.'),
  h('div', { class: 'field' }, h('label', { for: 'backup' }, 'Mã dự phòng'), code),
  err,
  submit,
  h('button', { class: 'btn link', type: 'button', onclick: () => { mode = 'totp'; Proto.render(); } }, 'Dùng ứng dụng xác thực'),
  lockedNote());
}

function enrollRequired() {
  const s = Proto.state();
  const role = Proto.ROLE_LABEL[Proto.role()];
  const reason = s === 'reset_by_admin'
    ? 'Admin đã đặt lại 2FA của bạn. Cài lại để tiếp tục — mã dự phòng cũ không còn dùng được.'
    : Proto.NEEDS_2FA.includes(Proto.role())
      ? `Vai trò ${role} bắt buộc xác thực 2 lớp. Cài xong mới vào được hệ thống.`
      : `Vai trò ${role} không bắt buộc 2FA — màn này chỉ xuất hiện với Owner, Admin, platform operator.`;
  return [
    h('div', { class: 'banner info', role: 'status', style: 'border-radius:var(--r-input)' }, reason),
    Proto.tfaEnroll({ onDone: () => Proto.toast('Đã bật xác thực 2 lớp — vào trang mặc định theo vai trò.'), doneLabel: 'Vào hệ thống' }),
  ];
}

Proto.mountBare({
  states: [
    ['normal', 'Nhập mã 6 số'],
    ['loading', 'Đang kiểm tra'],
    ['wrong', 'Mã sai'],
    ['locked', 'Khóa 30 phút (5 lần sai)'],
    ['backup', 'Dùng mã dự phòng'],
    ['enroll_required', 'Bắt buộc cài 2FA lần đầu'],
    ['reset_by_admin', 'Cài lại sau khi Admin đặt lại'],
    ['aioff', 'AI tắt — Không áp dụng'],
  ],
  render: () => {
    const s = Proto.state();
    if (s !== lastState) { mode = s === 'backup' ? 'backup' : 'totp'; lastState = s; }
    const enroll = s === 'enroll_required' || s === 'reset_by_admin';
    return h('main', { class: 'card stack auth-card' },
      Proto.noAiNote(),
      h('h1', {}, enroll ? 'Cài xác thực 2 lớp' : 'Xác thực 2 lớp'),
      enroll ? enrollRequired() : mode === 'backup' ? backupForm() : totpForm(),
      backToLogin());
  },
});
