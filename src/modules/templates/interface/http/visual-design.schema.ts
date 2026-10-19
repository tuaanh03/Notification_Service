import { z } from 'zod';
import { VISUAL_DESIGN_FORMAT, VISUAL_DESIGN_VERSION, type VisualDesign } from '../../domain/types/visual-design.ts';

/**
 * Hình dạng phần dự án của bộ soạn trực quan (ADR-0036). `project` là JSON của GrapesJS — backend không
 * hiểu bên trong, chỉ kiểm là object; cỡ kiểm ở domain (`checkVisualDesign`, mã `DESIGN_TOO_LARGE`).
 */
export const visualDesignSchema: z.ZodType<VisualDesign> = z
  .object({
    format: z.literal(VISUAL_DESIGN_FORMAT),
    version: z.literal(VISUAL_DESIGN_VERSION),
    project: z.record(z.string(), z.unknown()),
    mjml: z.string(),
  })
  .strict();
