/** Một mệnh đề lọc. Nguồn dữ liệu là user_tags (app service gán) hoặc dữ liệu hệ thống. */
export interface SegmentFilter {
  field: string;
  operator: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'not_in' | 'exists' | 'not_exists';
  value?: unknown;
}
