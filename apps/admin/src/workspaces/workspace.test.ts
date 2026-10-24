import { describe, expect, it } from 'vitest';

import { errorOf } from '../api/errors';
import {
  changeOf,
  draftOf,
  timeZones,
  withWorkspace,
  workspaceError,
  type Workspace,
} from './workspace';

const ws = (over: Partial<Workspace> = {}): Workspace => ({
  id: 'w1',
  slug: 'b2b',
  name: 'Gani B2B',
  template: 'b2b_sales',
  timezone: 'Asia/Ho_Chi_Minh',
  defaultMaxConcurrent: 5,
  createdAt: '2026-10-01T00:00:00.000Z',
  ...over,
});

describe('changeOf', () => {
  it('sends only what differs, the name trimmed', () => {
    const w = ws();
    expect(changeOf(w, draftOf(w))).toEqual({});
    expect(changeOf(w, { ...draftOf(w), name: '  Gani B2B mới ' })).toEqual({
      name: 'Gani B2B mới',
    });
    expect(changeOf(w, { name: 'Gani B2B', timezone: 'Asia/Bangkok', limit: ' 8 ' })).toEqual({
      timezone: 'Asia/Bangkok',
      defaultMaxConcurrent: 8,
    });
  });

  it('says a missing or long name and a limit out of 1 to 100', () => {
    const d = draftOf(ws());
    expect(changeOf(ws(), { ...d, name: '  ' })).toBe('Nhập tên workspace.');
    expect(changeOf(ws(), { ...d, name: 'x'.repeat(101) })).toMatch(/100 ký tự/);
    for (const limit of ['', '0', '101', '2.5', 'năm'])
      expect(changeOf(ws(), { ...d, limit })).toMatch(/1 đến 100/);
  });
});

describe('timeZones', () => {
  it('lists the zones of the browser, and keeps one it does not know first', () => {
    expect(timeZones('Asia/Ho_Chi_Minh')).toContain('Asia/Ho_Chi_Minh');
    expect(timeZones('Mars/Olympus')[0]).toBe('Mars/Olympus');
  });
});

describe('withWorkspace and workspaceError', () => {
  it('puts the answer of the API in place of its workspace', () => {
    const list = { data: [ws(), ws({ id: 'w2', name: 'CSKH' })] };
    const next = withWorkspace(list, ws({ name: 'Mới' }));
    expect(next?.data.map((w) => w.name)).toEqual(['Mới', 'CSKH']);
    expect(withWorkspace(undefined, ws())).toBeUndefined();
  });

  it('says a value refused, a refusal and a workspace gone in words of the screen', () => {
    expect(workspaceError(errorOf(400, { code: 'validation_failed' }))).toMatch(/múi giờ/);
    expect(workspaceError(errorOf(403, { code: 'forbidden' }))).toMatch(/Owner hoặc Admin/);
    expect(workspaceError(errorOf(404, { code: 'not_found' }))).toMatch(/Không tìm thấy/);
    expect(workspaceError(errorOf(503, {}))).toBe(errorOf(503, {}).message);
  });
});
