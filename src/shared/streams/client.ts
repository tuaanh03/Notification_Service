import { Redis } from 'ioredis';

export interface RedisHandle {
  /** Kết nối dùng chung cho lệnh không block (XADD, XACK, XPENDING...). */
  readonly client: Redis;
  /**
   * Kết nối RIÊNG cho một consumer: XREADGROUP ... BLOCK giữ kết nối tới khi có message,
   * mọi lệnh khác xếp hàng sau nó. Dùng chung kết nối thì relay/ack của nơi khác bị treo theo.
   * Handle giữ lại để `close()` đóng cả những kết nối này.
   */
  createBlockingConnection(name: string): Redis;
  close(): Promise<void>;
}

/**
 * `lazyConnect`: chỉ mở kết nối ở lệnh đầu tiên. Process không dùng Redis (job `migrate`) dựng
 * cùng container mà không chạm tới Redis.
 */
export function createRedis(options: { url: string; connectionName?: string }): RedisHandle {
  const client = new Redis(options.url, {
    connectionName: options.connectionName ?? 'ews-api',
    lazyConnect: true,
    // GHIM RESP2. ioredis 6 mặc định RESP3, và chế độ "legacy" của nó KHÔNG giữ nguyên hình dạng
    // mọi lệnh: XREADGROUP trả `[stream, entries]` phẳng thay vì `[[stream, entries]]` của RESP2.
    // StreamClient parse theo dạng RESP2 trong tài liệu Redis — không phụ thuộc mặc định thư viện.
    protocol: 2,
  });
  const blocking: Redis[] = [];

  return {
    client,
    createBlockingConnection: (name) => {
      const connection = client.duplicate({ connectionName: name });
      blocking.push(connection);
      return connection;
    },
    close: async () => {
      // Kết nối đang BLOCK thì cắt luôn, không đợi hết thời gian block.
      for (const connection of blocking) connection.disconnect();
      // quit() chờ lệnh đang chạy xong — nhưng chỉ có nghĩa khi đã từng kết nối.
      if (client.status === 'ready') await client.quit();
      else client.disconnect();
    },
  };
}

/** Health check: ném lỗi nếu Redis không trả lời. */
export async function pingRedis(handle: RedisHandle): Promise<void> {
  await handle.client.ping();
}
