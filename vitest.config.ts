import { defineConfig } from 'vitest/config';

/**
 * Hai project:
 *   unit        — domain thuần, không DB, chạy < 1 giây. `npm test` chỉ chạy project này
 *                 để vòng lặp dev không phụ thuộc Docker.
 *   integration — MySQL thật qua testcontainers (`npm run test:integration`). Cần Docker.
 */
export default defineConfig({
  test: {
    exclude: ['dist/**', 'node_modules/**'],
    projects: [
      {
        test: {
          name: 'unit',
          // Luật kiến trúc chạy chung với unit: nhanh, không cần Docker, chặn ngay khi vi phạm.
          include: ['test/unit/**/*.test.ts', 'test/architecture/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'integration',
          include: ['test/integration/**/*.test.ts'],
          globalSetup: ['test/integration/support/global-setup.ts'],
          // Kéo image + khởi động MySQL lần đầu có thể mất cả phút.
          hookTimeout: 120_000,
          testTimeout: 30_000,
        },
      },
    ],
  },
});
