import { describe, expect, it } from 'vitest';

import { errorOf } from '../api/errors';
import { changeOf, customerEditError, draftOf, mayEditCustomers, toE164 } from './customer-edit';
import type { Customer } from './customers';

const customer: Customer = {
  id: 'c1',
  displayName: 'Nguyễn Văn An',
  phone: '+84900000001',
  email: 'an@example.test',
  humanOnly: false,
  identities: [],
  createdAt: '2026-10-24T03:00:00.000Z',
  updatedAt: '2026-10-24T03:00:00.000Z',
};

describe('mayEditCustomers', () => {
  it('lets the roles that hold conversations change a profile, not Marketing or Viewer', () => {
    for (const role of ['owner', 'admin', 'manager', 'sales', 'support'] as const)
      expect(mayEditCustomers(role)).toBe(true);
    expect(mayEditCustomers('marketing')).toBe(false);
    expect(mayEditCustomers('viewer')).toBe(false);
  });
});

describe('toE164', () => {
  it('reads a number the usual ways, as the API stores it', () => {
    expect(toE164('0912 345 678')).toBe('+84912345678');
    expect(toE164('+84 912.345-678')).toBe('+84912345678');
    expect(toE164('84912345678')).toBe('+84912345678');
    expect(toE164('0065 9123 4567')).toBe('+6591234567');
  });
  it('refuses what is not a whole number', () => {
    expect(toE164('0912 abc')).toBeNull();
    expect(toE164('912345678')).toBeNull();
    expect(toE164('0123')).toBeNull();
    expect(toE164('+0912345678')).toBeNull();
  });
});

describe('draftOf and changeOf', () => {
  const draft = draftOf(customer);

  it('starts from the profile, the phone as people write it', () => {
    expect(draft).toEqual({
      name: 'Nguyễn Văn An',
      phone: '0900 000 001',
      email: 'an@example.test',
      humanOnly: false,
    });
  });
  it('sends nothing when nothing changed, however it is typed', () => {
    expect(
      changeOf(customer, { ...draft, phone: '+84 900 000 001', email: ' AN@example.test ' }),
    ).toEqual({});
  });
  it('sends only what changed, the phone in E.164 and the email in lower case', () => {
    expect(
      changeOf(customer, {
        name: ' An ',
        phone: '0912345678',
        email: 'An@Moi.vn',
        humanOnly: true,
      }),
    ).toEqual({ displayName: 'An', phone: '+84912345678', email: 'an@moi.vn', humanOnly: true });
  });
  it('clears a field left blank', () => {
    expect(changeOf(customer, { ...draft, name: ' ', phone: '', email: '' })).toEqual({
      displayName: null,
      phone: null,
      email: null,
    });
  });
  it('says why a value cannot be sent', () => {
    expect(changeOf(customer, { ...draft, name: 'x'.repeat(201) })).toBe('Tên tối đa 200 ký tự.');
    expect(changeOf(customer, { ...draft, phone: '0912' })).toContain('SĐT chưa đúng dạng');
    expect(changeOf(customer, { ...draft, email: 'an@' })).toContain('Email chưa đúng dạng');
  });
});

describe('customerEditError', () => {
  it('says each refusal in words of the screen', () => {
    expect(customerEditError(errorOf(400, { code: 'validation_failed' }))).toMatch(
      /Máy chủ không nhận/,
    );
    expect(customerEditError(errorOf(403, { code: 'forbidden' }))).toMatch(/không sửa được/);
    expect(customerEditError(errorOf(404, { code: 'not_found' }))).toMatch(/Không tìm thấy khách/);
    expect(customerEditError(errorOf(503, {}))).toBe(errorOf(503, {}).message);
  });
});
