import type { Job } from '../../../../shared/jobs/index.ts';
import type { DeliverDueWebhooks } from '../../application/index.ts';

/** Mỗi 5 giây (tính từ lúc lần trước xong): gọi các lượt webhook đến hạn. */
export function deliverWebhooksJob(useCases: { deliverDue: DeliverDueWebhooks }, everyMs = 5_000): Job {
  return {
    name: 'deliver-webhooks',
    everyMs,
    run: async () => {
      // Còn lượt đến hạn thì chạy tiếp ngay — một đợt dồn không phải chờ 5 giây cho mỗi 20 lượt.
      while ((await useCases.deliverDue.execute()) > 0);
    },
  };
}
