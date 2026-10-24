# ADR-0045 — OpenAPI sinh từ chính route: `/admin` (PAT), `/v1` (khoá app), `/hooks`

**Trạng thái:** chấp nhận — 2026-10-23.

## Bối cảnh

PAT (ADR-0044) mở toàn bộ API quản trị cho script của đội app. Họ cần biết route nào, body gì, quyền gì,
lỗi gì. Tài liệu viết tay (`huong-dan-tich-hop-cho-doi-app.md`) chỉ phủ `/v1` và đã từng lệch code.

## Quyết định

1. **Spec sinh lúc chạy từ route thật**, không viết tay: `buildHttpServer` gom mọi route `/admin`, `/v1`,
   `/hooks` (method, path, quyền ADR-0022) + mô tả khai ngay tại route bằng
   `{ config: { ...access('app.read'), ...doc({ summary, tags?, params?, query?, body?, response?, errors? }) } }`.
   `body` / `query` / `params` / `response` là CHÍNH schema zod route đang dùng để parse — chuyển sang
   JSON Schema bằng `z.toJSONSchema` (zod 4). Đổi schema là spec đổi theo.
2. **Route `/admin`, `/v1`, `/hooks` thiếu `doc(...)` -> test kiến trúc đỏ** (`test/architecture/openapi-docs.test.ts`,
   kiểm tĩnh mã nguồn). Không chặn lúc khởi động để harness test dựng route lẻ không phải khai doc. Không có
   route nào lọt khỏi spec vì quên.
3. **OpenAPI 3.1**, một tài liệu, hai `securitySchemes`: `pat` (`Authorization: Bearer ewspat_…`) cho
   `/admin`, `appKey` (`Authorization: Bearer ews_…`) cho `/v1`; `/hooks/{token}` không có security
   (token trên URL). Mỗi operation có `x-ews-permission` (quyền ADR-0022) và `x-ews-pat-scope`
   (`read` cho GET, `write` cho còn lại). Lỗi dùng chung `components.schemas.Problem` (RFC 9457).
4. **Phục vụ**: CHỈ `GET /admin/openapi.json` (quyền `catalog.read`, PAT hoặc phiên đều được) — người dùng
   chốt 2026-10-24: phải đăng nhập mới xem được spec (trang Developer của console, hoặc gọi bằng PAT). Không
   có bản public `/openapi.json`.
5. Response chưa khai schema thì mô tả bằng chữ + `x-ews-dto` (tên DTO trong `dto.ts`) — khai dần.

## Không làm

- Swagger UI phục vụ từ backend. Trang xem spec nằm ở console (`/developers`), theo design system Cosmic.
- "Thử gọi" từ trình duyệt bằng PAT (cần CORS ở backend — trái ADR-0015). Trang có lệnh curl để chép.

## Hệ quả

- `shared/http/openapi.ts` (dựng spec) + `doc()`; mọi file `*.routes.ts` khai `doc(...)`.
- Test: mọi route có doc; spec hợp lệ về cấu trúc; mọi `$ref` trỏ tới schema có thật.
- Console `/developers`: đọc spec qua BFF, nhóm theo tag, tìm, mỗi operation hiện method · path · quyền ·
  scope PAT · tham số · body (bảng + JSON mẫu) · response · mã lỗi · lệnh curl; nút tải `openapi.json`.
