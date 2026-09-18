// Barrel CHỈ gồm những thứ không kéo hạ tầng: kernel và port logging.
// Hạ tầng (db, config, pino) import thẳng từ thư mục của nó — để không file domain/application
// nào lỡ kéo Drizzle hay mysql2 vào qua một dòng `from '../shared/index.ts'`.
export * from './kernel/index.ts';
export * from './observability/logger.ts';
