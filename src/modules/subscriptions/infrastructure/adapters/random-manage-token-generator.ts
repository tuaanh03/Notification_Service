import { randomUUID } from 'node:crypto';
import type { ManageTokenGenerator } from '../../application/ports/index.ts';

/** UUID v4 từ CSPRNG của Node: 122 bit ngẫu nhiên, khớp cột CHAR(36) của `manage_token`. */
export class RandomManageTokenGenerator implements ManageTokenGenerator {
  next(): string {
    return randomUUID();
  }
}
