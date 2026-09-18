# ADR-0005 — TypeScript thay vì JavaScript thuần

**Trạng thái:** chấp nhận — 2026-09-17.

## Quyết định
TypeScript strict, cộng `noUncheckedIndexedAccess` và `exactOptionalPropertyTypes`.
Thêm `erasableSyntaxOnly` + `verbatimModuleSyntax` để code không dùng cú pháp cần biên dịch
(không `enum`, không `namespace`, không parameter property) — giữ đường lùi sang type stripping
của Node khi runtime hỗ trợ.

## Lợi ích lớn nhất, và là lý do chính
Branded id (`shared/kernel/ids.ts`). Mô hình B có `app_id`, `org_id`, `person_id`, `user_id`
đi cùng nhau trong gần như mọi hàm và **tất cả đều là UUID**. Không brand thì compiler im lặng
khi truyền nhầm — đúng loại lỗi mà composite FK sinh ra để chặn, nhưng chặn ở tận runtime.

## Ghi chú vận hành
Node 22.22.1 trên máy build hiện tại **không** có type stripping (`ERR_NO_TYPESCRIPT`).
Vì vậy `npm start` chạy `dist/` sau `tsc`, `npm run dev` dùng `tsx`.
Import dùng đuôi `.ts` thật; `rewriteRelativeImportExtensions` đổi sang `.js` lúc emit.
