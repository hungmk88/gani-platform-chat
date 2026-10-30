import { describe, expect, it } from 'vitest';

import { autonomyPath, changeOf, flagState, flagsPath, meaningOf } from './autonomy';

describe('Tự chủ & feature flag (#27)', () => {
  it('asks the routes of the workspace being worked in', () => {
    expect(autonomyPath('ws 1')).toBe('/v1/workspaces/ws%201/autonomy');
    expect(flagsPath('ws-e2e')).toBe('/v1/feature-flags?workspaceId=ws-e2e');
  });

  it('says what L0–L2 mean and that L3–L5 have no definition yet (U29)', () => {
    expect(meaningOf('L0')).toBe('Bot kịch bản, AI không trả lời khách');
    expect(meaningOf('L2')).toBe('AI được gọi tool, ví dụ tra giá (Đợt 2)');
    expect(meaningOf('L4')).toBe('chưa có định nghĩa (U29)');
  });

  it('says who changed the level with an id only, and when', () => {
    const at = '2026-10-29T17:30:00.000Z';
    expect(changeOf({ changedBy: 'user-owner', changedAt: at }, 'user-owner')).toBe(
      'Bạn, 00:30 30/10/2026',
    );
    expect(changeOf({ changedBy: 'user-admin', changedAt: at }, 'user-owner')).toBe(
      'Người khác, 00:30 30/10/2026',
    );
    expect(changeOf({ changedBy: null, changedAt: at }, 'user-owner')).toBe(
      'Hệ thống, 00:30 30/10/2026',
    );
    expect(changeOf({ changedBy: null, changedAt: null }, 'user-owner')).toBe('Chưa đổi lần nào');
  });

  it('puts a flag locked in this phase before on or off', () => {
    expect(flagState({ enabled: true, locked: false })).toBe('Đang bật');
    expect(flagState({ enabled: false, locked: false })).toBe('Đang tắt');
    expect(flagState({ enabled: false, locked: true })).toBe('Khóa ở Đợt 1');
    expect(flagState({ enabled: true, locked: true })).toBe('Khóa ở Đợt 1');
  });
});
