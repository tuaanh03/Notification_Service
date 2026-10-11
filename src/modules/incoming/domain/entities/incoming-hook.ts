import {
  BaseEntity,
  issue,
  ValidationError,
  type AppId,
  type IncomingHookId,
  type IncomingHookStatus,
  type Issue,
  type TemplateId,
  type TimestampInput,
  type TopicId,
} from '../../../../shared/kernel/index.ts';
import { parseJsonPath } from '../rules/json-path.ts';
import type { PublishCondition, VariableMapping } from '../types/hook-config.ts';

/** Tối đa 10 hook mỗi app — mỗi hook giữ một "chỗ", unique `(app_id, slot)` chốt khi chạy song song. */
export const MAX_INCOMING_HOOKS = 10;
export const MAX_MAPPINGS = 30;
export const MAX_TEXT_LENGTH = 500;
export const MAX_CONDITION_VALUES = 20;

const PAYLOAD_VARIABLE_RE = /^payload\.[A-Za-z_][A-Za-z0-9_]*$/;

export interface IncomingHookConfig {
  name: string;
  topicId: TopicId;
  templateId: TemplateId;
  mappings: readonly VariableMapping[];
  dedupePath: string | null;
  condition: PublishCondition | null;
}

export interface IncomingHookProps extends TimestampInput, IncomingHookConfig {
  id: IncomingHookId;
  appId: AppId;
  slot: number;
  /** SHA-256 hex của token — token gốc không lưu. */
  tokenHash: string;
  /** `ewshk_abcd…wxyz` — đủ nhận ra, không đủ dùng. */
  tokenHint: string;
  status?: IncomingHookStatus | undefined;
  createdBy?: string | null | undefined;
}

/**
 * MỘT URL bí mật để công cụ ngoài (Gatus, JSON tự build…) phát tin vào topic (ADR-0030). Gắn cố định
 * một topic + một template; bảng ánh xạ nói biến nào của template lấy từ đâu trong JSON gửi tới.
 */
export class IncomingHook extends BaseEntity<IncomingHookId> {
  readonly appId: AppId;
  readonly slot: number;
  readonly createdBy: string | null;
  name: string;
  topicId: TopicId;
  templateId: TemplateId;
  mappings: readonly VariableMapping[];
  dedupePath: string | null;
  condition: PublishCondition | null;
  tokenHash: string;
  tokenHint: string;
  status: IncomingHookStatus;

  constructor(props: IncomingHookProps) {
    super(props.id, props);
    if (!Number.isInteger(props.slot) || props.slot < 1 || props.slot > MAX_INCOMING_HOOKS) {
      throw new Error(`invalid incoming hook slot ${props.slot}`);
    }
    this.appId = props.appId;
    this.slot = props.slot;
    this.createdBy = props.createdBy ?? null;
    const config = validateHookConfig(props);
    this.name = config.name;
    this.topicId = config.topicId;
    this.templateId = config.templateId;
    this.mappings = config.mappings;
    this.dedupePath = config.dedupePath;
    this.condition = config.condition;
    this.tokenHash = props.tokenHash;
    this.tokenHint = props.tokenHint;
    this.status = props.status ?? 'active';
  }

  /** Chỗ trống cho hook mới; null = đã đủ 10. */
  static freeSlot(used: readonly number[]): number | null {
    for (let slot = 1; slot <= MAX_INCOMING_HOOKS; slot++) if (!used.includes(slot)) return slot;
    return null;
  }

  static assertHasFreeSlot(slot: number | null): asserts slot is number {
    if (slot === null) {
      throw ValidationError.of('INCOMING_HOOK_LIMIT_REACHED', `an app can have at most ${MAX_INCOMING_HOOKS} incoming webhooks`);
    }
  }

  reconfigure(config: IncomingHookConfig, at: Date): void {
    const valid = validateHookConfig(config);
    this.name = valid.name;
    this.topicId = valid.topicId;
    this.templateId = valid.templateId;
    this.mappings = valid.mappings;
    this.dedupePath = valid.dedupePath;
    this.condition = valid.condition;
    this.touch(at);
  }

  setStatus(status: IncomingHookStatus, at: Date): void {
    this.status = status;
    this.touch(at);
  }

  /** Đổi URL: token cũ hết hiệu lực ngay. */
  replaceToken(token: { hash: string; hint: string }, at: Date): void {
    this.tokenHash = token.hash;
    this.tokenHint = token.hint;
    this.touch(at);
  }
}

/** Kiểm HẾT rồi mới báo — người cấu hình thấy mọi dòng sai một lần. Chuẩn hoá khoảng trắng. */
export function validateHookConfig(config: IncomingHookConfig): IncomingHookConfig {
  const issues: Issue[] = [];
  const name = config.name.trim();
  if (name.length === 0 || name.length > 100) issues.push(issue('INCOMING_HOOK_NAME_INVALID', 'name must be 1-100 characters', 'name'));

  if (config.mappings.length > MAX_MAPPINGS) {
    issues.push(issue('INCOMING_MAPPING_INVALID', `at most ${MAX_MAPPINGS} mappings`, 'mappings'));
  }
  const seen = new Set<string>();
  const mappings = config.mappings.map((m, i): VariableMapping => {
    const at = `mappings.${i}`;
    if (!PAYLOAD_VARIABLE_RE.test(m.variable)) {
      issues.push(issue('INCOMING_MAPPING_INVALID', `${m.variable} is not a payload.<name> variable`, `${at}.variable`));
    } else if (seen.has(m.variable)) {
      issues.push(issue('INCOMING_MAPPING_INVALID', `${m.variable} is mapped twice`, `${at}.variable`));
    }
    seen.add(m.variable);
    if (m.kind === 'fixed') {
      if (m.value.length > MAX_TEXT_LENGTH) issues.push(issue('INCOMING_MAPPING_INVALID', 'fixed value is too long', `${at}.value`));
      return m;
    }
    collect(issues, () => parseJsonPath(m.path.trim(), `${at}.path`));
    if (m.defaultValue !== null && m.defaultValue.length > MAX_TEXT_LENGTH) {
      issues.push(issue('INCOMING_MAPPING_INVALID', 'default value is too long', `${at}.defaultValue`));
    }
    return { ...m, path: m.path.trim() };
  });

  const dedupePath = config.dedupePath === null || config.dedupePath.trim() === '' ? null : config.dedupePath.trim();
  if (dedupePath !== null) collect(issues, () => parseJsonPath(dedupePath, 'dedupePath'));

  let condition: PublishCondition | null = null;
  if (config.condition !== null) {
    const path = config.condition.path.trim();
    collect(issues, () => parseJsonPath(path, 'condition.path'));
    const values = [...new Set(config.condition.values.map((v) => v.trim()).filter((v) => v !== ''))];
    if (values.length === 0 || values.length > MAX_CONDITION_VALUES || values.some((v) => v.length > 200)) {
      issues.push(issue('INCOMING_CONDITION_INVALID', `condition needs 1-${MAX_CONDITION_VALUES} values`, 'condition.values'));
    }
    condition = { path, values };
  }

  if (issues.length > 0) throw new ValidationError(issues);
  return { name, topicId: config.topicId, templateId: config.templateId, mappings, dedupePath, condition };
}

function collect(issues: Issue[], check: () => unknown): void {
  try {
    check();
  } catch (err) {
    if (err instanceof ValidationError) issues.push(...err.issues);
    else throw err;
  }
}
