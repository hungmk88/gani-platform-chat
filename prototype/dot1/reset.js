/* global Proto */
/* #3 Quên / đặt lại mật khẩu (spec M8 §3.8, Phụ lục C v3 dòng 7, N162): `/api/auth/password/forgot` luôn 202 (một câu như
   nhau); link dùng một lần, hạn 30 phút; đặt lại thì mọi phiên bị thu hồi, không tự đăng nhập. */
const { h } = Proto;

const SENT = 'Nếu email có trong hệ thống, link đặt lại mật khẩu đã được gửi. Kiểm tra hộp thư (cả mục Spam).';

function requestForm() {
  const email = h('input', { id: 'email', class: 'input', type: 'email', autocomplete: 'username', required: true });
  const submit = h('button', { class: 'btn primary', type: 'submit' }, 'Gửi link đặt lại');
  return [
    h('h1', {}, 'Quên mật khẩu'),
    h('p', {}, 'Nhập email đăng nhập. Nếu có tài khoản, chúng tôi gửi link đặt lại mật khẩu.'),
    h('form', {
      class: 'stack',
      onsubmit: (e) => {
        e.preventDefault();
        // Cùng một câu dù email có hay không: không để lộ email nào có tài khoản.
        Proto.serverAction(submit, 'Gửi link đặt lại', () => Proto.set('state', 'sent'));
      },
    },
    h('div', { class: 'field' }, h('label', { for: 'email' }, 'Email'), email),
    submit),
  ];
}

function setForm() {
  const pass = h('input', { id: 'p1', class: 'input', type: 'password', autocomplete: 'new-password' });
  const again = h('input', { id: 'p2', class: 'input', type: 'password', autocomplete: 'new-password' });
  const err = h('p', { class: 'field-error', role: 'alert' },
    Proto.state() === 'weak' ? 'Mật khẩu cần ít nhất 12 ký tự, có số.' : '');
  const submit = h('button', { class: 'btn primary', type: 'submit' }, 'Đặt mật khẩu mới');
  return [
    h('h1', {}, 'Đặt mật khẩu mới'),
    h('form', {
      class: 'stack',
      onsubmit: (e) => {
        e.preventDefault();
        const problems = Proto.passwordProblems(pass.value);
        if (problems.length) { err.textContent = `Mật khẩu cần ${problems.join(', ')}.`; pass.classList.add('invalid'); return; }
        if (pass.value !== again.value) { err.textContent = 'Hai lần nhập mật khẩu chưa khớp.'; again.classList.add('invalid'); return; }
        err.textContent = '';
        Proto.serverAction(submit, 'Đặt mật khẩu mới', () => Proto.set('state', 'done'));
      },
    },
    h('div', { class: 'field' }, h('label', { for: 'p1' }, 'Mật khẩu mới (≥ 12 ký tự, có chữ và số)'), pass),
    h('div', { class: 'field' }, h('label', { for: 'p2' }, 'Nhập lại mật khẩu'), again),
    err,
    submit),
  ];
}

function body() {
  const s = Proto.state();
  const login = h('a', { class: 'btn', href: `login.html?role=${Proto.role()}` }, 'Đến trang đăng nhập');
  if (s === 'sent') return [h('h1', {}, 'Kiểm tra email'), h('p', { role: 'status' }, SENT), login];
  if (s === 'set' || s === 'weak') return setForm();
  if (s === 'done') return [h('h1', {}, 'Đã đặt mật khẩu mới'), h('p', { role: 'status' }, 'Các phiên đăng nhập cũ đã bị đăng xuất. Đăng nhập lại bằng mật khẩu mới.'), login];
  if (s === 'expired') {
    return [
      h('h1', {}, 'Link đã hết hạn hoặc đã dùng'),
      h('p', {}, 'Mỗi link chỉ dùng được 1 lần và có thời hạn. Xin link mới để đặt lại mật khẩu.'),
      h('a', { class: 'btn primary', href: `reset.html?role=${Proto.role()}` }, 'Xin link mới'),
    ];
  }
  return requestForm();
}

Proto.mountBare({
  states: [
    ['normal', 'Xin link (nhập email)'],
    ['sent', 'Đã gửi — cùng một câu'],
    ['set', 'Đặt mật khẩu mới'],
    ['weak', 'Mật khẩu không đủ mạnh'],
    ['done', 'Thành công'],
    ['expired', 'Link hết hạn hoặc đã dùng'],
    ['aioff', 'AI tắt — Không áp dụng'],
  ],
  render: () => h('main', { class: 'card stack auth-card' },
    Proto.noAiNote(),
    body()),
});
