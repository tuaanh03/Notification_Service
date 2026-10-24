# ADR-0044 — Personal access token (PAT): gọi toàn bộ API quản trị bằng khoá của chính mình

**Trạng thái:** chấp nhận — 2026-10-23.

## Bối cảnh

Đội nào muốn nối app của mình vào EWS hiện phải bấm tay trên console: tạo app, tạo chủ đề, soạn template,
cấp khoá API, thêm webhook. Người dùng chốt: mỗi người tự tạo được **PAT** (kiểu GitHub) để script / CI
của họ làm MỌI việc họ làm được trên console, qua đúng API `/admin/*`, kèm bộ OpenAPI (ADR-0045).

## Quyết định

1. **PAT là một cách xác thực thứ hai của `/admin/*`, cạnh phiên đăng nhập.** Header vẫn là
   `Authorization: Bearer <token>`; token bắt đầu bằng `ewspat_` thì đi đường PAT, còn lại là phiên.
   Caller vẫn là `AdminCaller` của chính người tạo — RBAC (ADR-0022) không đổi: PAT làm được đúng những
   gì người đó làm được, mất vai trong org thì PAT cũng mất theo, không có quyền riêng của PAT.
2. **Dạng token**: `ewspat_` + 32 byte ngẫu nhiên base64url (43 ký tự). Chỉ lưu SHA-256 (hex) + đoạn
   gợi nhớ `ewspat_…<4 ký tự cuối>`. Token gốc hiện MỘT lần trong response tạo, không lấy lại được.
3. **Phạm vi (`scope`)**: `read` — chỉ `GET` / `HEAD`, lệnh ghi trả 403 `PAT_SCOPE_INSUFFICIENT`;
   `write` — mọi phương thức. Không chia nhỏ hơn: quyền thật vẫn là RBAC.
4. **Hết hạn bắt buộc**: `expiresInDays` 1 … `pat.max_lifetime_days` (cài đặt hệ thống, mặc định 365,
   cho phép 1–3650). Không có PAT vĩnh viễn. Hết hạn / thu hồi / admin bị khoá hẳn (ADR-0039) -> 401
   `INVALID_ADMIN_SESSION` như phiên hỏng — không nói rõ lý do.
5. **Trần số PAT còn hiệu lực mỗi người**: cài đặt hệ thống `pat.max_per_admin` (mặc định 10, cho phép
   1–50). Khoá dòng `admins` rồi mới đếm (ADR-0009); vượt -> 422 `PAT_LIMIT_REACHED`.
6. **PAT không quản lý được PAT.** `…/me/tokens*` và `/admin/personal-access-tokens*` chỉ nhận PHIÊN;
   gọi bằng PAT -> 403 `SESSION_REQUIRED`. Lộ một PAT không đẻ ra được PAT mới sống lâu hơn nó.
7. **Dùng lần cuối**: `last_used_at` + `last_used_ip` cập nhật tối đa một lần mỗi phút mỗi token (không
   ghi DB ở mọi request).
8. **Audit**: `PersonalAccessTokenCreated` / `PersonalAccessTokenRevoked` (target `PersonalAccessToken`).
   Mọi lệnh ghi đi qua PAT có `source = 'admin_pat'` (thay `admin_api`); người làm vẫn là admin đó.
   Đủ để lọc "việc do script làm" mà không phải sửa payload của từng event.
9. **Super Admin** xem / thu hồi PAT của mọi người (`platform.manage`) — để dập token bị lộ.
10. **Đường vào từ Internet**: domain API (`api-ews-astrolink.eonsr.net`) đang chặn `/admin` và `/auth`
    ở NPM. Mở `/admin` CHỈ cho request mang `Authorization: Bearer ewspat_…`; phiên đăng nhập vẫn chỉ đi
    qua console (BFF). `/auth` vẫn chặn. Việc NPM là bước deploy riêng (ghi trong mục Hệ quả).

## Hợp đồng HTTP

Tất cả dưới `/admin`, quyền `self.read` (ai đăng nhập cũng có), CHỈ nhận phiên (mục 6).

| Route | Body / kết quả |
| --- | --- |
| `GET /me/tokens` | `{ tokens: PersonalAccessTokenDto[] }` — của chính mình, mới nhất trước, gồm cả đã hết hạn / thu hồi trong 30 ngày |
| `POST /me/tokens` | body `{ name: string (1–100, trim), scope: 'read' \| 'write', expiresInDays: int }` -> 201 `{ token: PersonalAccessTokenDto, secret: 'ewspat_…' }`, `cache-control: no-store` |
| `DELETE /me/tokens/:tokenId` | 204; không phải của mình / không có -> 404 `NOT_FOUND`; đã thu hồi -> 204 (lặp lại an toàn) |

Super Admin (`platform.manage`):

| Route | Body / kết quả |
| --- | --- |
| `GET /personal-access-tokens?status=active\|all` | `{ tokens: AdminPersonalAccessTokenDto[] }` (mặc định `active`) |
| `DELETE /personal-access-tokens/:tokenId` | 204, cùng luật như trên |

```ts
interface PersonalAccessTokenDto {
  tokenId: string;
  name: string;
  scope: 'read' | 'write';
  hint: string;               // "ewspat_…a1b2"
  status: 'active' | 'expired' | 'revoked';
  createdAt: string;          // ISO UTC
  expiresAt: string;
  lastUsedAt: string | null;
  lastUsedIp: string | null;
  revokedAt: string | null;
}
interface AdminPersonalAccessTokenDto extends PersonalAccessTokenDto {
  adminId: string;
  adminEmail: string;
  adminName: string | null;
}
```

`GET /admin/me` thêm `auth: { via: 'session' | 'pat'; tokenId: string | null; scope: 'read' | 'write' | null }`.

Mã lỗi mới: 403 `SESSION_REQUIRED`, 403 `PAT_SCOPE_INSUFFICIENT`; 422 `VALIDATION` với `issues[].code = 'PAT_LIMIT_REACHED'`,
hoặc `'PAT_LIFETIME_TOO_LONG'` (`path = expiresInDays`).

## Không làm

- Scope theo từng quyền / từng app (fine-grained). RBAC là đủ; cần hẹp hơn thì tạo tài khoản riêng.
- PAT cho `/v1` — app service vẫn dùng khoá API của app.
- Gia hạn PAT. Hết hạn thì tạo cái mới.

## Hệ quả

- Migration `personal_access_tokens` (module `tenancy`), 2 cài đặt hệ thống mới, nguồn audit `admin_pat`.
- `AdminCaller` thêm `via` + `tokenId` + `scope`; `buildHttpServer` chặn PAT `read` khi phương thức ghi.
- Deploy: thêm vào NPM (proxy host 57, ô Advanced) — mở `/admin` cho PAT, vẫn chặn phiên:
  ```nginx
  location ~ ^/admin(/|$) {
    if ($http_authorization !~* "^Bearer\s+ewspat_") { return 404; }
    include conf.d/include/proxy.conf;
  }
  location ~ ^/auth(/|$) { return 404; }
  ```
- Console: trang "Personal access token" trong menu tài khoản + trang Developer (ADR-0045).
