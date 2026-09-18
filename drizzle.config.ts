import type { Config } from 'drizzle-kit';

/**
 * Mỗi module sở hữu bảng của mình -> schema nằm trong infrastructure của module đó.
 * drizzle-kit gom lại qua glob, nhưng ranh giới sở hữu vẫn nằm ở thư mục.
 */
export default {
  dialect: 'mysql',
  schema: ['./src/modules/*/infrastructure/db/schema.ts', './src/shared/db/schema.ts'],
  out: './drizzle',
  dbCredentials: {
    url: process.env['DATABASE_URL'] ?? 'mysql://root:root@localhost:3306/ews_astrolink',
  },
} satisfies Config;
