import { describe, expect, it } from 'vitest';

import type { ApiError } from '../api/errors';
import {
  autonomyPath,
  changeOf,
  flagState,
  flagsPath,
  lowerChoices,
  lowerError,
  lowerReasonProblem,
  meaningOf,
  type Level,
} from './autonomy';

describe('Tự chủ & feature flag (#27)', () => {
  it('asks the routes of the workspace being worked in', () => {
    expect(autonomyPath('ws 1')).toBe('/v1/workspaces/ws%201/autonomy');
    expect(flagsPath('ws-e2e')).toBe('/v1/feature-flags?workspaceId=ws-e2e');
  });

  it('says what L0–L2 mean and that L3–L5 have no definition yet (U29)', () => {
    expect(meaningOf('L0')).toBe('Bot kịch bản, AI không trả lời khách');
    expect(meaningOf('L1')).toBe('AI trả lời khách chỉ từ Knowledge Base');
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

  it('lowers only to a level below the current one that the API offers; L2–L5 wait for Đợt 2', () => {
    const why = (level: Level, available: Level[]) =>
      lowerChoices({ level, available }).map((c) => c.why ?? 'chọn được');
    expect(why('L1', ['L0', 'L1'])).toEqual([
      'chọn được',
      'Mức hiện tại',
      ...Array<string>(4).fill('Chờ Đợt 2'),
    ]);
    expect(why('L0', ['L0', 'L1']).slice(0, 2)).toEqual(['Mức hiện tại', 'Cao hơn mức hiện tại']);
    expect(why('L1', ['L1'])[0]).toBe('Chưa chọn được');
  });

  it('asks a reason of 1–500 characters once trimmed', () => {
    expect(lowerReasonProblem('   ')).toBe('Ghi lý do hạ mức (bắt buộc, ghi audit).');
    expect(lowerReasonProblem(` ${'a'.repeat(500)} `)).toBeNull();
    expect(lowerReasonProblem('a'.repeat(501))).toBe('Lý do tối đa 500 ký tự.');
  });

  it('says who may lower it on a 403, and the sentence of errors.ts otherwise', () => {
    const e = (code: string, message: string) => ({ code, message }) as ApiError;
    expect(lowerError(e('forbidden', 'Bạn không có quyền làm việc này.'))).toBe(
      'Chỉ Owner hoặc Admin hạ được mức tự chủ.',
    );
    expect(lowerError(e('not_in_phase', 'Mức này mở ở Đợt 2.'))).toBe('Mức này mở ở Đợt 2.');
  });
});
