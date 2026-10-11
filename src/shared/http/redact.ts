/**
 * Token của incoming webhook nằm NGAY TRÊN URL (`POST /hooks/ewshk_…`) và URL chính là chìa khoá
 * (ADR-0030). Mọi chỗ server tự ghi URL ra ngoài — log mỗi request, `instance` / `detail` của lỗi —
 * đi qua đây: chỉ còn đoạn gợi nhớ `ewshk_xxxx…yyyy` (cùng dạng `tokenHint` của hook), đủ để đối chiếu
 * với console mà không gọi lại được. Chặn theo TIỀN TỐ ĐƯỜNG `/hooks/`, không theo dạng token: token
 * gõ sai một ký tự vẫn gần như là token thật.
 */
const HOOK_SEGMENT_RE = /(\/hooks\/)([^/?#]+)/g;

export function redactUrl(url: string): string {
  return url.replace(HOOK_SEGMENT_RE, (_match, prefix: string, segment: string) =>
    `${prefix}${segment.length > 14 ? `${segment.slice(0, 10)}…${segment.slice(-4)}` : '…'}`,
  );
}
