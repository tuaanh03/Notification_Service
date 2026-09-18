import {
  BaseEntity,
  ValidationError,
  type AppId,
  type SegmentId,
  type TimestampInput,
} from '../../../../shared/kernel/index.ts';
import type { SegmentFilter } from '../types/segment-filter.ts';

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
    if (!name) throw ValidationError.of('SEGMENT_NAME_REQUIRED', 'segment name must not be empty', 'name');
    this.appId = props.appId;
    this.name = name;
    this.filters = props.filters ?? [];
  }
}
