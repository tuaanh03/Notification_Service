/**
 * Event phát ra ngoài module (audit, worker, module khác nghe). Chỉ mang nghĩa nghiệp vụ —
 * stream nào nhận event là chi tiết vận chuyển, do hạ tầng định tuyến theo `eventType`.
 */
export interface IntegrationEvent {
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  payload: Record<string, unknown>;
}

/**
 * PORT: ghi event vào outbox. PHẢI gọi bên trong `UnitOfWork.run` — hiện thực từ chối nếu không
 * có transaction đang mở, vì ghi ngoài transaction là mất đúng thứ outbox tồn tại để bảo đảm:
 * "nghiệp vụ commit nhưng event không bao giờ đi" hoặc ngược lại.
 */
export interface EventOutbox {
  append(events: readonly IntegrationEvent[]): Promise<void>;
}
