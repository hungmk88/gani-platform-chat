import { describe, expect, it } from 'vitest';

import { createPiiVault, maskPii, unmaskPii, type PiiMaskOptions } from './pii-masker.js';

const mask = (text: string, options?: PiiMaskOptions) => {
  const vault = createPiiVault();
  return { masked: maskPii(text, vault, options), vault };
};

describe('maskPii', () => {
  it('masks emails and Vietnamese phone numbers in their usual spellings', () => {
    expect(mask('Mail an.nguyen+gf@gani.com.vn nhé').masked).toBe('Mail [EMAIL_1] nhé');
    for (const phone of [
      '0912345678',
      '0912 345 678',
      '091.234.5678',
      '+84912345678',
      '84 912 345 678',
      '02838123456',
    ])
      expect(mask(`Gọi ${phone} giúp em`).masked).toBe('Gọi [PHONE_1] giúp em');
    // Too short, or part of a longer word: not a phone.
    expect(mask('Mã 091234 và SP0912345678x').masked).toBe('Mã 091234 và SP0912345678x');
  });

  it('masks a tax id, a bank account, an id card and a birth date after their keyword', () => {
    expect(mask('MST: 0101234567-001').masked).toBe('MST: [TAX_ID_1]');
    expect(mask('mã số thuế 0312345678').masked).toBe('mã số thuế [TAX_ID_1]');
    expect(mask('STK 0123 4567 8901 Vietcombank').masked).toBe('STK [BANK_ACCOUNT_1] Vietcombank');
    expect(mask('so tai khoan la 19033445566').masked).toBe('so tai khoan la [BANK_ACCOUNT_1]');
    expect(mask('CCCD 001099012345').masked).toBe('CCCD [ID_NUMBER_1]');
    expect(mask('cmnd: 123456789').masked).toBe('cmnd: [ID_NUMBER_1]');
    expect(mask('ngày sinh 12/03/1990').masked).toBe('ngày sinh [DOB_1]');
    // A CCCD needs no keyword; a delivery date is no birth date.
    expect(mask('số 001099012345 nhé').masked).toBe('số [ID_NUMBER_1] nhé');
    expect(mask('giao ngày 12/03/2027').masked).toBe('giao ngày 12/03/2027');
  });

  it('masks a detailed address, with or without diacritics, and leaves a district alone', () => {
    expect(mask('Giao tới 123/4 Nguyễn Trãi, Phường 2, Quận 5, TP. HCM nhé').masked).toBe(
      'Giao tới 123/4 Nguyễn Trãi, Phường 2, Quận 5, TP. HCM nhé',
    );
    expect(mask('Giao tới 123/4 đường Nguyễn Trãi, Phường 2, Quận 5, TP. HCM.').masked).toBe(
      'Giao tới [ADDRESS_1].',
    );
    expect(mask('dia chi: so 12 duong Le Loi, phuong Ben Nghe, quan 1').masked).toBe(
      'dia chi: [ADDRESS_1]',
    );
    expect(mask('Nhà ở thôn Đông, xã Tân Hội, huyện Đan Phượng; gọi trước').masked).toBe(
      'Nhà ở [ADDRESS_1]; gọi trước',
    );
    expect(mask('Bên em ở quận 3 thôi').masked).toBe('Bên em ở quận 3 thôi');
  });

  it('masks order numbers by the default pattern or the tenant patterns', () => {
    expect(mask('Đơn DH123456 với GF_20261 đâu rồi').masked).toBe(
      'Đơn [ORDER_ID_1] với [ORDER_ID_2] đâu rồi',
    );
    // Known gap of the default (U76): the last group of GF-2026-00123 is left.
    expect(mask('Đơn GF-2026-00123').masked).toBe('Đơn [ORDER_ID_1]-00123');
    expect(mask('Đơn GF-2026-00123', { orderIdPatterns: [/\bGF-\d{4}-\d{5}\b/g] }).masked).toBe(
      'Đơn [ORDER_ID_1]',
    );
    expect(mask('Đơn DH123456', { orderIdPatterns: [] }).masked).toBe('Đơn DH123456');
  });

  it('masks a known name in any case and with or without diacritics, and only a known one', () => {
    const options = { knownNames: ['Nguyễn Văn An', 'Trần Thị Bích', '  '] };
    expect(mask('Chào Nguyễn Văn An, chị trần thi bich cũng hỏi', options).masked).toBe(
      'Chào [NAME_1], chị [NAME_2] cũng hỏi',
    );
    expect(mask('anh nguyen  van an oi', options).masked).toBe('anh [NAME_1] oi');
    // Not guessed: an unknown name stays; a known name inside a longer word stays.
    expect(mask('Chào Lê Minh Tâm', options).masked).toBe('Chào Lê Minh Tâm');
    expect(mask('Nguyễn Văn Anh', options).masked).toBe('Nguyễn Văn Anh');
    expect(mask('Gửi A.B (test)', { knownNames: ['A.B (test)'] }).masked).toBe('Gửi [NAME_1]');
  });

  it('gives one value one placeholder across messages of the same vault, and numbers each type on its own', () => {
    const vault = createPiiVault();
    expect(maskPii('0912345678 và 0987654321', vault)).toBe('[PHONE_1] và [PHONE_2]');
    expect(maskPii('lại 0912345678, mail a@b.vn', vault)).toBe('lại [PHONE_1], mail [EMAIL_1]');
  });
});

describe('unmaskPii', () => {
  it('puts the originals back in the answer of the model, and leaves a placeholder it does not know', () => {
    const { masked, vault } = mask(
      'Anh Nguyễn Văn An, 0912345678, giao 12 đường Lê Lợi, Quận 1, đơn DH123456',
      {
        knownNames: ['Nguyễn Văn An'],
      },
    );
    expect(masked).toBe('Anh [NAME_1], [PHONE_1], giao [ADDRESS_1], đơn [ORDER_ID_1]');
    const answer =
      'Dạ [NAME_1], đơn [ORDER_ID_1] giao tới [ADDRESS_1], em gọi [PHONE_1]. [EMAIL_9] {{price_1}}';
    expect(unmaskPii(answer, vault)).toBe(
      'Dạ Nguyễn Văn An, đơn DH123456 giao tới 12 đường Lê Lợi, Quận 1, em gọi 0912345678. [EMAIL_9] {{price_1}}',
    );
  });
});
