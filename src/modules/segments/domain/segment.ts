import {
  BaseEntity,
  ValidationError,
  type AppId,
  type SegmentId,
  type TimestampInput,
} from '../../../shared/kernel/index.ts';

/** Một mệnh đề lọc. Nguồn dữ liệu là user_tags (app service gán) hoặc dữ liệu hệ thống. */
export interface SegmentFilter {
  field: string;
  operator: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'not_in' | 'exists' | 'not_exists';
  value?: unknown;
}

export interface SegmentProps extends TimestampInput {
  id: SegmentId;
  appId: AppId;
  name: string;
  filters?: readonly SegmentFilter[] | undefined;
}

/**
 * Segment = kho TARGETING: tập filter ĐỘNG, đánh giá lại tại thời điểm gửi.
 * Không phải cơ chế "gán tag rồi lọc theo tag" — user tự rơi vào/ra segment.
 *
 * Vì đánh giá lúc gửi nên số người nhận lúc soạn chỉ là ƯỚC LƯỢNG (SM-5).
 */
export class Segment extends BaseEntity<SegmentId> {
  readonly appId: AppId;
  name: string;
  filters: readonly SegmentFilter[];

  constructor(props: SegmentProps) {
    super(props.id, props);
    const name = props.name.trim();
    if (!name) throw new ValidationError(['segment name không được rỗng']);
    this.appId = props.appId;
    this.name = name;
    this.filters = props.filters ?? [];
  }
}
