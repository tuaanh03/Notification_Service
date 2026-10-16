export const USER_AGGREGATE = 'User';

export const USER_EVENTS = {
  created: 'UserCreated',
  /** Xoá mềm trên console. */
  deleted: 'UserDeleted',
  /** Người đã xoá được app (hoặc console) khai lại. */
  restored: 'UserRestored',
} as const;
