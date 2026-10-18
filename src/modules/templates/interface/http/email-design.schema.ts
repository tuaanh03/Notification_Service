import { z } from 'zod';
import { DESIGN_LIMITS } from '../../domain/rules/email-design.ts';
import {
  DESIGN_ALIGNS,
  DESIGN_FONTS,
  EMAIL_DESIGN_VERSION,
  type EmailDesign,
} from '../../domain/types/email-design.ts';

/**
 * Hình dạng thiết kế kéo-thả (ADR-0034) — zod chỉ được ở tầng interface (luật kiến trúc). Ở đây chỉ kiểm
 * kiểu, khoảng số, độ dài chữ; giới hạn số hàng / khối / cỡ JSON và link ảnh kiểm ở domain (`checkDesign`)
 * để có mã lỗi riêng. Màu chỉ `#rrggbb`: không có ô CSS tự do nào đi thẳng vào `style`.
 */
const COLOR = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'color must be #rrggbb');
const ID = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, 'id must be 1-64 letters, digits, _ or -');
const ALIGN = z.enum(DESIGN_ALIGNS);
const TEXT = z.string().max(DESIGN_LIMITS.textChars);

const block = z.discriminatedUnion('type', [
  z.object({ id: ID, type: z.literal('heading'), text: TEXT, level: z.union([z.literal(1), z.literal(2), z.literal(3)]), align: ALIGN, color: COLOR.optional() }).strict(),
  z.object({ id: ID, type: z.literal('text'), text: TEXT, align: ALIGN, color: COLOR.optional() }).strict(),
  z
    .object({
      id: ID,
      type: z.literal('button'),
      label: TEXT,
      url: TEXT,
      align: ALIGN,
      backgroundColor: COLOR,
      textColor: COLOR,
      borderRadius: z.number().int().min(0).max(24),
    })
    .strict(),
  z
    .object({
      id: ID,
      type: z.literal('image'),
      src: TEXT,
      alt: TEXT.default(''),
      width: z.number().int().min(10).max(100),
      link: TEXT.default(''),
      align: ALIGN,
    })
    .strict(),
  z.object({ id: ID, type: z.literal('divider'), color: COLOR, thickness: z.number().int().min(1).max(8) }).strict(),
  z.object({ id: ID, type: z.literal('spacer'), height: z.number().int().min(4).max(120) }).strict(),
  z.object({ id: ID, type: z.literal('html'), html: z.string().max(DESIGN_LIMITS.htmlBlockChars) }).strict(),
]);

export const emailDesignSchema: z.ZodType<EmailDesign> = z
  .object({
    version: z.literal(EMAIL_DESIGN_VERSION),
    settings: z
      .object({
        width: z.number().int().min(480).max(600),
        backgroundColor: COLOR,
        contentBackgroundColor: COLOR,
        textColor: COLOR,
        linkColor: COLOR,
        fontFamily: z.enum(DESIGN_FONTS),
      })
      .strict(),
    // Trần ở đây rộng hơn domain một chút: vượt trần domain thì ra mã riêng (`DESIGN_TOO_MANY_ROWS`…),
    // trần zod chỉ để không phải đọc mảng khổng lồ.
    rows: z
      .array(
        z
          .object({
            id: ID,
            backgroundColor: COLOR.optional(),
            columns: z
              .array(z.object({ id: ID, blocks: z.array(block).max(DESIGN_LIMITS.blocks * 2) }).strict())
              .min(1)
              .max(DESIGN_LIMITS.columnsPerRow),
          })
          .strict(),
      )
      .max(DESIGN_LIMITS.rows * 2),
  })
  .strict() as z.ZodType<EmailDesign>;
