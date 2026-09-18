/** Trạng thái trả lời "tới đâu rồi"; counters trả lời "bao nhiêu". Không suy cái này từ cái kia. */
export interface Counters {
  resolved: number;
  sent: number;
  bounced: number;
  failed: number;
  skipped: number;
  optedOut: number;
  noChannel: number;
}

export const EMPTY_COUNTERS: Counters = {
  resolved: 0,
  sent: 0,
  bounced: 0,
  failed: 0,
  skipped: 0,
  optedOut: 0,
  noChannel: 0,
};
