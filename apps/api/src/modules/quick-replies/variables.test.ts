import { describe, expect, it } from 'vitest';

import { unknownVariables, variablesOf } from './variables.js';

describe('template variables', () => {
  it('finds each variable once, in order, spaces inside the braces allowed', () => {
    expect(
      variablesOf('Chào {{customer_name}}, em là {{ agent_name }} của {{customer_name}}'),
    ).toEqual(['customer_name', 'agent_name']);
    expect(variablesOf('Không có biến, chỉ {một} ngoặc')).toEqual([]);
  });

  it('names the variables that are not of Đợt 1, an empty one included', () => {
    expect(unknownVariables('{{company_name}} {{company_phone}}')).toEqual([]);
    expect(unknownVariables('{{price_1}} {{ }} {{Customer_Name}}')).toEqual([
      'price_1',
      '',
      'Customer_Name',
    ]);
  });
});
