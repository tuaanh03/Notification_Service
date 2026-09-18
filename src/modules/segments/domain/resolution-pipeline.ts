import type {
  Channel,
  ExclusionReason,
  PersonId,
  SegmentId,
  SubscriptionId,
  TopicId,
  UserId,
} from '../../../shared/kernel/index.ts';
import {
  channelGate,
  type SubscriptionGateState,
} from '../../subscriptions/domain/subscription-gate.ts';

/**
 * PIPELINE GIẢI NGƯỜI NHẬN — nơi DUY NHẤT tính số người nhận trong toàn hệ thống.
 *
 * Hàm thuần: mọi dữ liệu đã được port load sẵn, không đụng DB, không đụng Redis.
 * Hai chế độ:
 *   estimate — lúc soạn/hẹn giờ, chỉ đếm, không ghi gì, kết quả có computed_at.
 *   snapshot — tại lối vào `queued`, trả recipients để ghi notification_recipients
 *              trong cùng transaction với `queued -> sending`.
 *
 * Điều kiện gửi là phép GIAO của mọi lớp: chỉ cần một lớp fail là loại.
 *
 * NGOẠI LỆ DEPENDENCY RULE: file này import `channelGate` từ domain của module
 * subscriptions. Có chủ đích — viết lại rule opt-out ở hai nơi nguy hiểm hơn nhiều
 * so với một import giữa hai hàm thuần, không tables, không I/O. Xem ADR-0010.
 */

export type ResolveMode = 'estimate' | 'snapshot';

/** Gộp theo user (gửi trong một app) hay theo person (broadcast toàn org / app SYS). */
export type DedupeBy = 'user' | 'person';

export interface CandidateSubscription extends SubscriptionGateState {
  id: SubscriptionId;
  channel: Channel;
  value: string;
}

/** Một ứng viên đã khớp targeting, kèm đủ dữ liệu để chạy các lớp lọc còn lại. */
export interface Candidate {
  userId: UserId;
  personId: PersonId | null;
  segmentIds: readonly SegmentId[];
  /** Subscription của user trên kênh đang gửi; null = không có điểm nhận. */
  subscription: CandidateSubscription | null;
  /** Dòng user_topic_preferences, null = chưa có -> dùng defaultOptedIn của topic. */
  preference: { optedIn: boolean } | null;
}

export interface TopicView {
  id: TopicId;
  mandatory: boolean;
  /** Suy từ defaultMode: 'opt_out' -> true, 'opt_in' -> false. */
  defaultOptedIn: boolean;
}

export interface ResolutionRequest {
  mode: ResolveMode;
  channel: Channel;
  topic: TopicView;
  /** 'all' = gửi toàn bộ user của app; mảng = các segment được nhắm tới. */
  includedSegments: 'all' | readonly SegmentId[];
  excludedSegments?: readonly SegmentId[] | undefined;
  dedupeBy?: DedupeBy | undefined;
  computedAt: Date;
}

export interface RecipientSnapshot {
  userId: UserId;
  personId: PersonId | null;
  subscriptionId: SubscriptionId;
  channel: Channel;
  address: string;
  includedVia: SegmentId | 'all_users';
}

export interface Exclusion {
  userId: UserId;
  reason: ExclusionReason;
}

export interface ResolutionSteps {
  candidates: number;
  deduped: number;
  withChannel: number;
  afterChannelGate: number;
  afterExcluded: number;
  expected: number;
}

export interface ResolutionResult {
  mode: ResolveMode;
  computedAt: Date;
  dedupeBy: DedupeBy;
  steps: ResolutionSteps;
  expected: number;
  /** Rỗng khi mode = 'estimate'. */
  recipients: readonly RecipientSnapshot[];
  exclusions: readonly Exclusion[];
}

export function resolveRecipients(
  candidates: readonly Candidate[],
  request: ResolutionRequest,
): ResolutionResult {
  const dedupeBy: DedupeBy = request.dedupeBy ?? 'user';
  const excluded = new Set<SegmentId>(request.excludedSegments ?? []);
  const exclusions: Exclusion[] = [];
  const recipients: RecipientSnapshot[] = [];

  // --- Bước 2: gộp trùng ------------------------------------------------
  // Một người khớp nhiều segment (vừa buyer vừa seller) chỉ nhận MỘT lần.
  // Broadcast toàn org gộp theo person_id, vì cùng một người thật ở nhiều app.
  const seen = new Set<string>();
  const deduped: Candidate[] = [];
  for (const candidate of candidates) {
    const key =
      dedupeBy === 'person' && candidate.personId !== null
        ? `p:${candidate.personId}`
        : `u:${candidate.userId}`;
    if (seen.has(key)) {
      exclusions.push({ userId: candidate.userId, reason: 'duplicate' });
      continue;
    }
    seen.add(key);
    deduped.push(candidate);
  }

  // --- Bước 3: map sang subscription khớp kênh --------------------------
  const withChannel: Array<Candidate & { subscription: CandidateSubscription }> = [];
  for (const candidate of deduped) {
    const sub = candidate.subscription;
    if (sub === null || sub.channel !== request.channel) {
      exclusions.push({ userId: candidate.userId, reason: 'no_channel' });
      continue;
    }
    withChannel.push({ ...candidate, subscription: sub });
  }

  // --- Bước 4 + 5: kênh còn sống? đã tắt tin không bắt buộc chưa? -------
  // channelGate giữ đúng ngoại lệ: L0 không bao giờ bỏ qua, L1 bỏ qua nếu mandatory.
  const afterGate: typeof withChannel = [];
  for (const candidate of withChannel) {
    const gate = channelGate(candidate.subscription, { topicMandatory: request.topic.mandatory });
    if (!gate.allowed) {
      exclusions.push({ userId: candidate.userId, reason: gate.reason });
      continue;
    }
    afterGate.push(candidate);
  }

  // --- Bước 6: trừ excluded (excluded THẮNG included) -------------------
  const afterExcluded: typeof withChannel = [];
  for (const candidate of afterGate) {
    if (candidate.segmentIds.some((id) => excluded.has(id))) {
      exclusions.push({ userId: candidate.userId, reason: 'excluded' });
      continue;
    }
    afterExcluded.push(candidate);
  }

  // --- Bước 7: preference theo topic (bỏ qua nếu mandatory) -------------
  for (const candidate of afterExcluded) {
    const optedIn = request.topic.mandatory
      ? true
      : (candidate.preference?.optedIn ?? request.topic.defaultOptedIn);
    if (!optedIn) {
      exclusions.push({ userId: candidate.userId, reason: 'opted_out' });
      continue;
    }
    if (request.mode === 'snapshot') {
      recipients.push({
        userId: candidate.userId,
        personId: candidate.personId,
        subscriptionId: candidate.subscription.id,
        channel: candidate.subscription.channel,
        address: candidate.subscription.value,
        includedVia: includedVia(candidate.segmentIds, request.includedSegments),
      });
    }
  }

  const expected =
    afterExcluded.length -
    exclusions.filter((exclusion) => exclusion.reason === 'opted_out').length;

  return {
    mode: request.mode,
    computedAt: request.computedAt,
    dedupeBy,
    steps: {
      candidates: candidates.length,
      deduped: deduped.length,
      withChannel: withChannel.length,
      afterChannelGate: afterGate.length,
      afterExcluded: afterExcluded.length,
      expected,
    },
    expected,
    recipients,
    exclusions,
  };
}

function includedVia(
  segmentIds: readonly SegmentId[],
  included: 'all' | readonly SegmentId[],
): SegmentId | 'all_users' {
  if (included === 'all') return 'all_users';
  const hit = segmentIds.find((id) => included.includes(id));
  return hit ?? 'all_users';
}
