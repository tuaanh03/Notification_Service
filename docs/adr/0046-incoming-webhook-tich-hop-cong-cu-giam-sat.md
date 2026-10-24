# ADR-0046 — Incoming webhook: cắm thẳng Datadog, Grafana, Alertmanager, Gatus, Uptime Kuma

**Trạng thái:** chấp nhận — 2026-10-23. Bổ sung ADR-0030.

## Bối cảnh

Người dùng muốn cảnh báo "cắm vào là chạy" như cách Datadog nối với các công cụ khác: chọn công cụ, dán
URL, dán body mẫu, xong. Incoming webhook (ADR-0030) đã nhận JSON và ánh xạ đường dẫn, nhưng console giấu
phần ánh xạ (bổ sung 2026-10-11) — nên chỉ công cụ tự đặt được body (trường trùng tên biến) mới dùng được,
và người dùng phải tự biết biến của template alert tên gì.

## Quyết định

1. **Danh mục công cụ viết trong code** (`incoming/domain/rules/integrations.ts`), không migration cho danh
   mục. Hai loại:
   - `custom` — công cụ cho tự viết body (Datadog, Gatus, Uptime Kuma): danh mục giữ **token của công cụ**
     cho từng biến (`$EVENT_TITLE`, `[ENDPOINT_NAME]`, `{{ monitorJSON['name'] }}`…). EWS dựng sẵn body để dán.
   - `fixed` — công cụ gửi JSON cố định (Grafana, Prometheus Alertmanager): danh mục giữ **đường dẫn JSON**
     cho từng biến (`commonLabels.alertname`, `alerts[0].startsAt`…). EWS tự điền ánh xạ, người dùng không
     phải viết gì.
   - `generic` — như cũ: trường cùng tên biến.
2. **Khoá là tên biến của template alert dựng sẵn** (ADR-0035): `incident_title`, `severity`, `started_at`,
   `detail_url`, `resolved_at`, `summary`. Template tự soạn dùng đúng các tên đó thì cũng được điền; biến
   khác tên vẫn lấy theo trường cùng tên (ADR-0030 §2) — "truyền thêm giá trị" là thêm trường vào body.
3. **Kích hoạt theo trạng thái cảnh báo** (`trigger`): `firing` (đang lỗi) · `resolved` (đã khắc phục) ·
   `all`. Mỗi công cụ khai trường trạng thái + giá trị (`status` = `firing` / `resolved` với Grafana;
   `$ALERT_TRANSITION` = `Triggered` / `Recovered` với Datadog…). EWS đổi `trigger` thành điều kiện phát
   (ADR-0030 §3). Cách dùng chuẩn là hai hook, hai URL: "Cảnh báo sự cố" + `firing` và "Sự cố đã khắc
   phục" + `resolved`. Công cụ nào chỉ cho khai một URL thì dùng một hook `all` + một template.
4. **Hook lưu `integration` + `trigger`** (migration). Lưu / sửa hook có `integration` mà KHÔNG gửi
   `mappings` -> backend tự dựng ánh xạ = danh mục ∩ biến của bản template đang xuất bản, và điều kiện từ
   `trigger`. Gửi `mappings` / `condition` tường minh thì dùng đúng cái đã gửi (API cho ca đặc biệt).
   Đổi template -> dựng lại theo template mới.
5. **Body mẫu do backend dựng** (`setupBody` trong DTO hook, chỉ công cụ `custom`): mỗi biến của template
   -> token của công cụ nếu danh mục có, không thì giá trị mẫu của biến; cộng trường trạng thái. Console chỉ
   hiện + nút sao chép — không có logic dựng body ở hai nơi.

## Hợp đồng HTTP

`GET /admin/incoming-integrations` (quyền `catalog.read`) -> `{ integrations: IncomingIntegrationDto[] }`:

```ts
type IncomingIntegrationId = 'generic' | 'datadog' | 'grafana' | 'alertmanager' | 'gatus' | 'uptime-kuma';
interface IncomingIntegrationDto {
  id: IncomingIntegrationId;
  name: string;                    // "Datadog"
  payload: 'generic' | 'custom' | 'fixed';
  docsUrl: string | null;          // trang hướng dẫn webhook của công cụ
  /** Biến (không có tiền tố payload.) -> token (custom) hoặc đường dẫn JSON (fixed). */
  fields: Array<{ variable: string; source: string }>;
  /** Trường trạng thái: custom = tên trường thêm vào body + token; fixed = đường dẫn. null = không phân biệt. */
  status: { field: string; source: string; firing: string[]; resolved: string[] } | null;
  /** Các bước cài trên công cụ — chữ ngắn, đã dịch: vi / en. */
  steps: { vi: string[]; en: string[] };
}
```

Body tạo / sửa hook (`POST` / `PATCH …/incoming-webhooks`) thêm hai trường tuỳ chọn trong `config`:
`integration: IncomingIntegrationId | null` và `trigger: 'firing' | 'resolved' | 'all' | null`
(`trigger` chỉ có nghĩa khi công cụ có `status`; thiếu = `all`). `mappings` thành tuỳ chọn (mặc định `[]`).

DTO hook thêm: `integration: IncomingIntegrationId | null`, `trigger: 'firing' | 'resolved' | 'all' | null`,
`setupBody: Record<string, string> | null`.

Lỗi mới: 422 `issues[].code = 'INTEGRATION_UNKNOWN'` (`path = config.integration`).

## Không làm

- Tự nhận ra công cụ từ body. Người dùng chọn công cụ lúc tạo.
- Định dạng lại ngày giờ của công cụ (ISO, epoch) — đổ nguyên văn. Làm sau nếu cần.
- Công cụ ngoài danh sách: dùng `generic` (công cụ tự đặt body) hoặc ánh xạ qua API.

## Hệ quả

- Migration: `incoming_hooks.integration`, `incoming_hooks.alert_trigger`.
- Console (tab "Nhận vào"): ô chọn công cụ (logo chữ, không ảnh ngoài) khi thêm hook; với template chưa có
  thì gợi ý tạo từ mẫu "Cảnh báo sự cố" / "Sự cố đã khắc phục"; mở hook hiện các bước + `setupBody`.
