import { json, mysqlTable, uniqueIndex, varchar } from 'drizzle-orm/mysql-core';
import { tsNow, uuid, uuidPk } from '../../../../shared/db/columns.ts';
import { apps } from '../../../apps/infrastructure/db/schema.ts';
import type { SegmentFilter } from '../../domain/types/segment-filter.ts';

/**
 * Segment = kho TARGETING. `filters` là bộ lọc động, đánh giá lại lúc gửi.
 * MySQL: JSON thay cho jsonb — không có GIN index, muốn lọc nhanh theo một field
 * thì thêm generated column + index cho đúng field đó.
 */
export const segments = mysqlTable(
  'segments',
  {
    segmentId: uuidPk('segment_id'),
    appId: uuid('app_id')
      .notNull()
      .references(() => apps.appId),
    name: varchar('name', { length: 200 }).notNull(),
    filters: json('filters').$type<SegmentFilter[]>().notNull().default([]),
    createdAt: tsNow('created_at'),
    updatedAt: tsNow('updated_at'),
  },
  (t) => [uniqueIndex('uq_segments_app_name').on(t.appId, t.name)],
);
