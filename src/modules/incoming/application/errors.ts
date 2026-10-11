import { ConflictError } from '../../../shared/kernel/index.ts';

/** Hai lệnh thêm hook cùng chọn một chỗ — bên thua đọc lại và thử chỗ khác. Không ra tới HTTP. */
export class IncomingSlotTakenError extends ConflictError {
  constructor() {
    super('INCOMING_SLOT_TAKEN', 'incoming webhook slot was taken concurrently');
  }
}
