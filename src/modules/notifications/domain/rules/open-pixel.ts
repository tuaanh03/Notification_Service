/**
 * Ảnh 1×1 đếm "đã mở" (ADR-0031). Hàm thuần — URL do application ghép từ domain công khai + chữ ký.
 *
 * Con số chỉ là ƯỚC LƯỢNG: Outlook bản cài máy hay chặn ảnh (đã mở mà không đếm), Apple Mail tải
 * sẵn ảnh (chưa mở mà đã đếm). Không dùng nó làm bằng chứng người nhận đã đọc.
 */

/** Đường ảnh trên bề mặt public: `/t/o/<notificationId>/<chữ ký>.gif`. */
export function openPixelPath(notificationId: string, signature: string): string {
  return `/t/o/${notificationId}/${signature}.gif`;
}

/**
 * Chèn ảnh ngay trước `</body>` cuối cùng; HTML không có `</body>` (template chỉ là đoạn thân) thì
 * nối vào cuối. Không đụng phần còn lại của HTML.
 */
export function withOpenPixel(html: string, pixelUrl: string): string {
  const src = pixelUrl.replaceAll('&', '&amp;').replaceAll('"', '&quot;');
  const img = `<img src="${src}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0;" />`;
  const at = html.toLowerCase().lastIndexOf('</body>');
  return at === -1 ? `${html}${img}` : `${html.slice(0, at)}${img}${html.slice(at)}`;
}
