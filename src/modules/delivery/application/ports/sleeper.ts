/** Chờ giữa hai lần thử. Port để test không phải chờ thật. */
export interface Sleeper {
  sleep(ms: number): Promise<void>;
}
