import { describe, expect, it } from 'vitest';

import { flowsPath, publishedText, STATUS } from './bot-flows';

describe('Bot flows, read only (#17, CEO 01/11)', () => {
  it('asks the flows of one workspace', () => {
    expect(flowsPath('ws 1')).toBe('/v1/bot-flows?workspaceId=ws+1');
  });

  it('says each state and what was published in words', () => {
    expect(Object.values(STATUS).map(([label]) => label)).toEqual([
      'Nháp, chưa xuất bản',
      'Đang chạy',
      'Tạm dừng',
    ]);
    expect([publishedText(null), publishedText(3)]).toEqual(['Chưa xuất bản', 'Phiên bản 3']);
  });
});
