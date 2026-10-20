/* global Proto */
/* Luồng cài 2FA dùng chung cho #2 (bắt buộc cài khi đăng nhập) và #5 (tab Bảo mật).
   Spec M8 §3.8, Q-U20-2: QR → mã 6 số → 10 mã dự phòng hiện 1 lần, phải tick "Tôi đã lưu". */
(() => {
  const { h } = Proto;

  Proto.NEEDS_2FA = ['owner', 'admin', 'platform_operator'];

  // Mã giả cho prototype — app thật lấy từ `/api/auth/two-factor/enable`, chỉ hiện 1 lần.
  Proto.BACKUP_CODES = ['k7m2-q9xp', 'w4rt-8bzn', 'p3hd-6cye', 'm9fa-2ujq', 'x5ln-7gvo', 't2bw-4rke', 'j8cs-1ymd', 'f6qu-3hza', 'r1vn-9ept', 'h4go-5wlc'];

  /* Trả về một khối tự vẽ lại giữa 2 bước, không phụ thuộc Proto.render của trang.
     onCancel = null thì không có nút Hủy (cài bắt buộc). */
  Proto.tfaEnroll = ({ onDone, onCancel = null, doneLabel = 'Xong' }) => {
    const box = h('div', { class: 'stack' });

    function qrStep() {
      const code = h('input', { id: 'totp', class: 'input', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: '6' });
      const err = h('p', { class: 'field-error', role: 'alert' });
      const verify = h('button', { class: 'btn primary', type: 'submit' }, 'Xác nhận');
      box.replaceChildren(h('form', {
        class: 'stack',
        onsubmit: (e) => {
          e.preventDefault();
          if (!/^\d{6}$/.test(code.value)) { err.textContent = 'Nhập đủ 6 số từ ứng dụng xác thực.'; code.classList.add('invalid'); return; }
          Proto.serverAction(verify, 'Xác nhận', codesStep);
        },
      },
      h('p', {}, 'Bước 1/2 — Quét mã QR bằng ứng dụng xác thực (Google Authenticator, Microsoft Authenticator…).'),
      h('div', { class: 'qr', role: 'img', 'aria-label': 'Mã QR (giả lập)' }, 'QR'),
      h('p', { class: 'small muted' }, 'Không quét được? Nhập khóa thủ công: JBSW Y3DP EHPK 3PXP'),
      h('div', { class: 'field' }, h('label', { for: 'totp' }, 'Mã 6 số trong ứng dụng'), code),
      err,
      h('div', { class: 'row' }, verify, onCancel ? h('button', { class: 'btn', type: 'button', onclick: onCancel }, 'Hủy') : null)));
    }

    function codesStep() {
      const saved = h('input', { id: 'saved', type: 'checkbox' });
      const done = h('button', { class: 'btn primary', disabled: true, onclick: onDone }, doneLabel);
      saved.addEventListener('change', () => { done.disabled = !saved.checked; });
      box.replaceChildren(
        h('p', {}, 'Bước 2/2 — 10 mã dự phòng. Mỗi mã dùng 1 lần khi mất điện thoại. ', h('strong', {}, 'Mã chỉ hiện 1 lần này.')),
        h('ol', { class: 'codes' }, Proto.BACKUP_CODES.map((c) => h('li', {}, h('code', {}, c)))),
        h('div', { class: 'row' },
          h('button', { class: 'btn', onclick: () => Proto.toast('Đã chép 10 mã.') }, 'Chép'),
          h('button', { class: 'btn', onclick: () => Proto.toast('Đã tải tệp mã dự phòng.') }, 'Tải tệp .txt')),
        h('label', { class: 'row', for: 'saved' }, saved, 'Tôi đã lưu 10 mã dự phòng ở nơi an toàn'),
        done);
    }

    qrStep();
    return box;
  };
})();
