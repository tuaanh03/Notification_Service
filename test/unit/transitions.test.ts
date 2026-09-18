import { describe, expect, it } from 'vitest';
import {
  NOTIFICATION_STATUSES,
  TERMINAL_STATUSES,
  InvalidTransitionError,
} from '../../src/shared/kernel/index.ts';
import {
  canTransition,
  eventsFrom,
  isTerminal,
  nextStatus,
  TRANSITIONS,
} from '../../src/modules/notifications/domain/rules/transitions.ts';

describe('bảng chuyển trạng thái notification', () => {
  it('có đúng 11 trạng thái', () => {
    expect(NOTIFICATION_STATUSES).toHaveLength(11);
    expect(new Set(NOTIFICATION_STATUSES).size).toBe(11);
  });

  it('6 trạng thái kết thúc không có đường ra (SM-2: không quay lui)', () => {
    expect(TERMINAL_STATUSES).toHaveLength(6);
    for (const status of TERMINAL_STATUSES) {
      expect(isTerminal(status)).toBe(true);
      expect(eventsFrom(status)).toEqual([]);
      expect(Object.hasOwn(TRANSITIONS, status)).toBe(false);
    }
  });

  it('mọi trạng thái không kết thúc đều có ít nhất một đường ra', () => {
    const nonTerminal = NOTIFICATION_STATUSES.filter((status) => !isTerminal(status));
    expect(nonTerminal).toHaveLength(5);
    for (const status of nonTerminal) {
      expect(eventsFrom(status).length).toBeGreaterThan(0);
    }
  });

  it('event không có trong bảng thì throw, không âm thầm bỏ qua', () => {
    expect(() => nextStatus('draft', 'approve')).toThrow(InvalidTransitionError);
    expect(() => nextStatus('sent', 'stop')).toThrow(InvalidTransitionError);
  });

  describe('vạch phân chia queued -> sending', () => {
    it('Huỷ CHỈ hợp lệ ở queued và scheduled, không hợp lệ ở sending', () => {
      expect(canTransition('queued', 'cancel')).toBe(true);
      expect(canTransition('scheduled', 'cancel')).toBe(true);
      expect(canTransition('sending', 'cancel')).toBe(false);
    });

    it('Dừng CHỈ hợp lệ ở sending, không hợp lệ ở queued', () => {
      expect(canTransition('sending', 'stop')).toBe(true);
      expect(canTransition('queued', 'stop')).toBe(false);
    });

    it('queued đi được sang cả sending lẫn cancelled — đây là race mà DB phải phân xử', () => {
      expect(nextStatus('queued', 'first_batch_left')).toBe('sending');
      expect(nextStatus('queued', 'cancel')).toBe('cancelled');
    });
  });

  it('cả hai lối vào queued đều tồn tại: API và Dashboard', () => {
    expect(nextStatus('draft', 'submit')).toBe('queued');
    expect(nextStatus('pending_approval', 'approve')).toBe('queued');
    expect(nextStatus('scheduled', 'due')).toBe('queued');
  });

  it('vượt ngưỡng thì phải qua duyệt, không đi thẳng vào queued', () => {
    expect(nextStatus('draft', 'submit_over_threshold')).toBe('pending_approval');
  });
});
