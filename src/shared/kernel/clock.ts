/** Thời gian là dependency, không phải lời gọi tĩnh — để test cố định được. */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};

export function fixedClock(at: Date): Clock {
  return { now: () => new Date(at) };
}
