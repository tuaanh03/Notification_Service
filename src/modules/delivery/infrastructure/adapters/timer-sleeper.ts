import type { Sleeper } from '../../application/ports/index.ts';

export class TimerSleeper implements Sleeper {
  sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
