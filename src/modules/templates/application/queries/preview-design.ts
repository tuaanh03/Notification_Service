import { assertDesign, renderDesign } from '../../domain/rules/email-design.ts';
import type { EmailDesign } from '../../domain/types/email-design.ts';

/**
 * Xem trước thiết kế ĐANG SOẠN (chưa lưu) — ADR-0034. Cùng hàm sinh và cùng giới hạn với lúc lưu nháp,
 * nên console không phải giữ bản sao hàm sinh. Không ghi gì, không cần template.
 */
export class PreviewDesign {
  execute(design: EmailDesign): { html: string; text: string } {
    assertDesign(design);
    return renderDesign(design);
  }
}
