import { describe, expect, it } from 'vitest';

import { render, unknownVariables, variablesOf } from './variables.js';

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

  it('renders the variables that have a value and names the others, leaving them as written', () => {
    expect(
      render(
        'Chào {{customer_name}}, em là {{ agent_name }}. Gọi {{company_phone}} hoặc {{company_phone}}.',
        {
          customer_name: 'Lan',
          agent_name: '  ',
          company_phone: null,
        },
      ),
    ).toEqual({
      text: 'Chào Lan, em là {{ agent_name }}. Gọi {{company_phone}} hoặc {{company_phone}}.',
      unresolved: ['agent_name', 'company_phone'],
    });
    expect(render('Không biến', {})).toEqual({ text: 'Không biến', unresolved: [] });
  });
});
