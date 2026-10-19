import type { TemplatePreset } from '../types/template-preset.ts';
import { INCIDENT_ALERT, INCIDENT_RESOLVED } from './alert-presets.ts';
import { APPROVAL_REQUEST, APPROVAL_RESULT } from './approval-presets.ts';
import { ACCOUNT_READY, WELCOME } from './onboarding-presets.ts';
import { MEETING_REMINDER, TASK_DUE_REMINDER } from './reminder-presets.ts';
import { PERIODIC_REPORT } from './report-presets.ts';
import { MAINTENANCE_NOTICE, NEW_DEVICE_SIGN_IN, PASSWORD_RESET } from './system-presets.ts';

/**
 * Thư viện mẫu dựng sẵn (ADR-0035) — chỉ đọc, xếp theo thứ tự nhóm của `TEMPLATE_CATEGORIES`.
 * Thêm mẫu = thêm vào đây; test `template-presets.test.ts` kiểm mọi mẫu × mọi ngôn ngữ qua đúng luật xuất bản.
 */
export const TEMPLATE_PRESETS: readonly TemplatePreset[] = [
  INCIDENT_ALERT,
  INCIDENT_RESOLVED,
  NEW_DEVICE_SIGN_IN,
  MAINTENANCE_NOTICE,
  PASSWORD_RESET,
  WELCOME,
  ACCOUNT_READY,
  TASK_DUE_REMINDER,
  MEETING_REMINDER,
  APPROVAL_REQUEST,
  APPROVAL_RESULT,
  PERIODIC_REPORT,
];

export const findPreset = (id: string): TemplatePreset | undefined => TEMPLATE_PRESETS.find((p) => p.id === id);
