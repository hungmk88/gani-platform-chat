import { describe, expect, it } from 'vitest';

import {
  fieldsOf,
  fill,
  knownOf,
  phoneOf,
  phonesOf,
  slashQuery,
  unresolvedProblem,
  variablesIn,
} from './templates';

describe('slashQuery', () => {
  it('opens on "/" and the start of a shortcut filling the whole box, in lower case', () => {
    expect(slashQuery('/')).toBe('');
    expect(slashQuery('/Gia-1')).toBe('gia-1');
  });
  it('stays closed for any other text', () => {
    expect(slashQuery('')).toBeNull();
    expect(slashQuery('a /gia')).toBeNull();
    expect(slashQuery('/gia ')).toBeNull();
    expect(slashQuery('/giá')).toBeNull();
    expect(slashQuery(`/${'x'.repeat(33)}`)).toBeNull();
  });
});

describe('knownOf', () => {
  it('knows the name of the person and of the company, never a blank one', () => {
    expect(knownOf({ name: ' An ', org: { id: 'o', name: 'Gani', role: 'sales' } })).toEqual({
      agent_name: 'An',
      company_name: 'Gani',
    });
    expect(knownOf({ name: ' ', org: null })).toEqual({});
  });
});

describe('fill, variablesIn and fieldsOf', () => {
  const body = 'Chào {{ customer_name }}, em là {{agent_name}} ({{company_phone}}) {{agent_name}}';

  it('replaces the variables with a value, trimmed, and leaves the others', () => {
    expect(fill(body, { agent_name: ' An ', customer_name: '  ' })).toBe(
      'Chào {{ customer_name }}, em là An ({{company_phone}}) An',
    );
  });
  it('reads each name once, in order, as the API does', () => {
    expect(variablesIn(body)).toEqual(['customer_name', 'agent_name', 'company_phone']);
    expect(variablesIn('{{x}} {{}}')).toEqual(['x', '']);
  });
  it('gives a field to each variable of Đợt 1 left, in the order of the template screen', () => {
    expect(fieldsOf(body).map((f) => f.label)).toEqual([
      'Tên khách',
      'Tên nhân viên',
      'SĐT công ty',
    ]);
    expect(fieldsOf('{{la}}')).toEqual([]);
  });
});

describe('unresolvedProblem', () => {
  it('lets a text with no {{…}} go', () => {
    expect(unresolvedProblem('Chào anh {chị}')).toBeNull();
  });
  it('asks to fill the variables of Đợt 1 left, in words', () => {
    expect(unresolvedProblem('{{company_phone}} {{customer_name}}')).toBe(
      'Điền Tên khách, SĐT công ty trước khi gửi.',
    );
  });
  it('asks to take out a variable no field fills', () => {
    expect(unresolvedProblem('{{customer_name}} {{la}}')).toBe(
      'Xóa {{la}} khỏi tin: biến này không điền được.',
    );
  });
});

describe('phonesOf and phoneOf', () => {
  const phones = phonesOf({
    workspaces: [
      { id: 'w1', name: 'B2B', contactPhone: ' 028 3812 3456 ' },
      { id: 'w2', name: 'CSKH', contactPhone: null },
      { id: 'w3', name: 'Lẻ', contactPhone: '  ' },
    ],
  });

  it('keeps the number of each workspace that has one, trimmed', () => {
    expect(phones).toEqual({ w1: '028 3812 3456' });
  });
  it('gives {{company_phone}} of the workspace of the conversation when it has a number', () => {
    expect(phoneOf(phones, 'w1')).toEqual({ company_phone: '028 3812 3456' });
    expect(phoneOf(phones, 'w2')).toEqual({});
    expect(phoneOf(phones, 'w9')).toEqual({});
  });
});
