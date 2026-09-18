import type {
  Channel,
  ExclusionReason,
  PersonId,
  SegmentId,
  SubscriptionId,
  TopicId,
  UserId,
} from '../../../../shared/kernel/index.ts';
import {
  channelGate,
  type SubscriptionGateState,
} from '../../../subscriptions/domain/rules/subscription-gate.ts';
import { effectiveOptIn, type ConsentTopic } from '../../../topics/domain/rules/topic-consent.ts';

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
 * LỌC TRƯỚC, GỘP SAU. Gộp theo person trước khi lọc sẽ giữ lại user đứng đầu danh sách
 * — nếu user đó chết kênh thì cả person bị loại oan dù user kia của cùng người vẫn nhận
 * được, và kết quả lại phụ thuộc thứ tự SQL trả về. Vì vậy:
 *   - kênh + L0/L1 xét RIÊNG TỪNG USER (kênh của app này chết không kéo app kia chết theo);
 *   - excluded và L3 xét trên CẢ NHÓM (một user bị excluded / tắt topic -> cả người bị loại);
 *   - cuối cùng mới chọn đúng một user đại diện, theo quy tắc cố định.
 * Khi `dedupeBy = 'user'` mỗi nhóm chỉ có một user nên hai cách xét trùng nhau.
 *
 * NGOẠI LỆ DEPENDENCY RULE: file này import `channelGate` (subscriptions) và
 * `effectiveOptIn` (topics) — đều là hàm thuần của domain. Có chủ đích: viết lại rule
 * consent ở hai nơi nguy hiểm hơn nhiều so với import. Xem ADR-0010.
 *
 * Giả định đầu vào: mỗi user có TỐI ĐA MỘT subscription trên kênh đang gửi — application
 * chọn sẵn trước khi dựng Candidate. PK (notification_id, user_id, channel) của
 * notification_recipients cũng chốt đúng điều này.
 */

export type ResolveMode = 'estimate' | 'snapshot';

/** Gộp theo user (gửi trong một app) hay theo person (broadcast toàn org / app SYS). */
export type DedupeBy = 'user' | 'person';

export interface CandidateSubscription extends SubscriptionGateState {
  id: SubscriptionId;
  channel: Channel;
  value: string;
  /** Dùng để chọn user đại diện khi gộp theo person. */
  createdAt: Date;
}

/** Một ứng viên đã khớp targeting, kèm đủ dữ liệu để chạy các lớp lọc còn lại. */
export interface Candidate {
  userId: UserId;
  personId: PersonId | null;
  /** User thuộc app SYS — được ưu tiên làm đại diện khi gộp theo person. */
  isSystemApp: boolean;
  segmentIds: readonly SegmentId[];
  /** Subscription của user trên kênh đang gửi; null = không có điểm nhận. */
  subscription: CandidateSubscription | null;
  /** Dòng user_topic_preferences, null = chưa có -> dùng defaultOptedIn của topic. */
  preference: { optedIn: boolean } | null;
}

export interface TopicView extends ConsentTopic {
  id: TopicId;
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
  /** Số dòng đầu vào (một user khớp nhiều segment có thể xuất hiện nhiều lần). */
  candidates: number;
  /** Sau khi gộp các dòng trùng của cùng một user. */
  users: number;
  withChannel: number;
  afterChannelGate: number;
  afterExcluded: number;
  afterPreference: number;
  /** Sau khi chọn một user đại diện cho mỗi nhóm. */
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

type Reachable = Candidate & { subscription: CandidateSubscription };

export function resolveRecipients(
  candidates: readonly Candidate[],
  request: ResolutionRequest,
): ResolutionResult {
  const dedupeBy: DedupeBy = request.dedupeBy ?? 'user';
  const excludedSegments = new Set<SegmentId>(request.excludedSegments ?? []);
  const exclusions: Exclusion[] = [];
  const exclude = (userId: UserId, reason: ExclusionReason): void => {
    exclusions.push({ userId, reason });
  };

  // --- Bước 1: gộp các dòng trùng của cùng một user ------------------------
  // Một user khớp nhiều segment có thể tới nhiều dòng. Hợp segmentIds lại để bước
  // excluded thấy đủ mọi segment của user đó.
  const users = mergeRowsByUser(candidates, exclude);

  // Nhóm theo người nhận thật: person khi broadcast toàn org, user trong trường hợp còn lại.
  const groupKey = (c: Candidate): string =>
    dedupeBy === 'person' && c.personId !== null ? `p:${c.personId}` : `u:${c.userId}`;

  // Hai điều kiện xét trên CẢ NHÓM, tính trên MỌI user của nhóm — kể cả user sẽ rớt ở
  // bước kênh — vì chúng nói về con người, không nói về điểm nhận.
  const excludedGroups = new Set<string>();
  const optedOutGroups = new Set<string>();
  for (const user of users) {
    if (user.segmentIds.some((id) => excludedSegments.has(id))) excludedGroups.add(groupKey(user));
    if (!effectiveOptIn(request.topic, user.preference)) optedOutGroups.add(groupKey(user));
  }

  // --- Bước 2: map sang subscription khớp kênh (từng user) -----------------
  const withChannel: Reachable[] = [];
  for (const user of users) {
    const sub = user.subscription;
    if (sub === null || sub.channel !== request.channel) {
      exclude(user.userId, 'no_channel');
      continue;
    }
    withChannel.push({ ...user, subscription: sub });
  }

  // --- Bước 3: L0 kênh còn sống + L1 tắt tin không bắt buộc (từng user) ----
  // channelGate giữ đúng ngoại lệ: L0 không bao giờ bỏ qua, L1 bỏ qua nếu mandatory.
  const afterGate: Reachable[] = [];
  for (const user of withChannel) {
    const gate = channelGate(user.subscription, { topicMandatory: request.topic.mandatory });
    if (!gate.allowed) {
      exclude(user.userId, gate.reason);
      continue;
    }
    afterGate.push(user);
  }

  // --- Bước 4: trừ excluded — excluded THẮNG included (cả nhóm) -------------
  const afterExcluded: Reachable[] = [];
  for (const user of afterGate) {
    if (excludedGroups.has(groupKey(user))) {
      exclude(user.userId, 'excluded');
      continue;
    }
    afterExcluded.push(user);
  }

  // --- Bước 5: L3 preference theo topic (cả nhóm; mandatory bỏ qua) ---------
  // Một user của người đó đã tắt topic -> không gửi cho người đó qua bất kỳ user nào.
  const afterPreference: Reachable[] = [];
  for (const user of afterExcluded) {
    if (optedOutGroups.has(groupKey(user))) {
      exclude(user.userId, 'opted_out');
      continue;
    }
    afterPreference.push(user);
  }

  // --- Bước 6: chọn MỘT user đại diện cho mỗi nhóm -------------------------
  const representatives = new Map<string, Reachable>();
  for (const user of afterPreference) {
    const key = groupKey(user);
    const current = representatives.get(key);
    if (current === undefined || compareRepresentative(user, current) < 0) {
      representatives.set(key, user);
    }
  }
  const chosen = new Set<UserId>([...representatives.values()].map((user) => user.userId));
  const final: Reachable[] = [];
  for (const user of afterPreference) {
    if (chosen.has(user.userId)) final.push(user);
    else exclude(user.userId, 'duplicate');
  }

  // --- Bước 7: snapshot ------------------------------------------------------
  const recipients: RecipientSnapshot[] =
    request.mode === 'snapshot'
      ? final.map((user) => ({
          userId: user.userId,
          personId: user.personId,
          subscriptionId: user.subscription.id,
          channel: user.subscription.channel,
          address: user.subscription.value,
          includedVia: includedVia(user.segmentIds, request.includedSegments),
        }))
      : [];

  return {
    mode: request.mode,
    computedAt: request.computedAt,
    dedupeBy,
    steps: {
      candidates: candidates.length,
      users: users.length,
      withChannel: withChannel.length,
      afterChannelGate: afterGate.length,
      afterExcluded: afterExcluded.length,
      afterPreference: afterPreference.length,
      expected: final.length,
    },
    expected: final.length,
    recipients,
    exclusions,
  };
}

function mergeRowsByUser(
  candidates: readonly Candidate[],
  exclude: (userId: UserId, reason: ExclusionReason) => void,
): Candidate[] {
  const byUser = new Map<UserId, Candidate>();
  for (const candidate of candidates) {
    const existing = byUser.get(candidate.userId);
    if (existing === undefined) {
      byUser.set(candidate.userId, candidate);
      continue;
    }
    exclude(candidate.userId, 'duplicate');
    const segmentIds = [...new Set([...existing.segmentIds, ...candidate.segmentIds])];
    byUser.set(candidate.userId, { ...existing, segmentIds });
  }
  return [...byUser.values()];
}

/**
 * Quy tắc chọn đại diện — cố định để kết quả không phụ thuộc thứ tự đầu vào:
 *   1. user của app SYS
 *   2. subscription tạo sớm nhất
 *   3. userId nhỏ nhất
 * Âm = `a` được ưu tiên hơn `b`.
 */
function compareRepresentative(a: Reachable, b: Reachable): number {
  if (a.isSystemApp !== b.isSystemApp) return a.isSystemApp ? -1 : 1;
  const byCreated = a.subscription.createdAt.getTime() - b.subscription.createdAt.getTime();
  if (byCreated !== 0) return byCreated;
  return a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0;
}

function includedVia(
  segmentIds: readonly SegmentId[],
  included: 'all' | readonly SegmentId[],
): SegmentId | 'all_users' {
  if (included === 'all') return 'all_users';
  const hit = segmentIds.find((id) => included.includes(id));
  return hit ?? 'all_users';
}
