/**
 * Bộ soạn trực quan (ADR-0036) — GrapesJS + grapesjs-mjml chạy ở trình duyệt. Lưu ở `template_versions.design`
 * khi `editor = 'visual'`:
 *   project — JSON dự án của GrapesJS (`editor.getProjectData()`), để mở lại đúng như lúc soạn (kể cả chip biến);
 *   mjml    — MJML xuất ra, để đọc / chuyển sau này mà không cần GrapesJS.
 * HTML gửi đi nằm ở cột `html` (trình duyệt sinh, backend đã kiểm), không ở đây.
 *
 * Backend KHÔNG hiểu `project` — chỉ kiểm cỡ. `version` tăng khi đổi cấu trúc gói này.
 */
export const VISUAL_DESIGN_FORMAT = 'grapesjs-mjml';
export const VISUAL_DESIGN_VERSION = 1;

export interface VisualDesign {
  format: typeof VISUAL_DESIGN_FORMAT;
  version: typeof VISUAL_DESIGN_VERSION;
  project: Record<string, unknown>;
  mjml: string;
}

export const emptyVisualDesign = (): VisualDesign => ({ format: VISUAL_DESIGN_FORMAT, version: VISUAL_DESIGN_VERSION, project: {}, mjml: '' });
