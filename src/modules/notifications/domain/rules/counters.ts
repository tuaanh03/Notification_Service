import type { Counters } from '../types/counters.ts';

export function addCounters(base: Counters, delta: Partial<Counters>): Counters {
  return {
    resolved: base.resolved + (delta.resolved ?? 0),
    sent: base.sent + (delta.sent ?? 0),
    bounced: base.bounced + (delta.bounced ?? 0),
    failed: base.failed + (delta.failed ?? 0),
    skipped: base.skipped + (delta.skipped ?? 0),
    optedOut: base.optedOut + (delta.optedOut ?? 0),
    noChannel: base.noChannel + (delta.noChannel ?? 0),
  };
}

/** Lô cuối đã về -> trạng thái kết thúc nào? */
export function outcomeOf(counters: Counters): 'all_accepted' | 'some_failed' | 'all_failed' {
  const bad = counters.bounced + counters.failed;
  if (counters.sent === 0 && bad > 0) return 'all_failed';
  if (bad > 0) return 'some_failed';
  return 'all_accepted';
}
