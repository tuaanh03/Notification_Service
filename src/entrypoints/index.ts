/**
 * Mỗi process một folder, cùng một khuôn:
 *   <process>/main.ts           file CHẠY — import vào là khởi động process (Docker/npm gọi file này)
 *   <process>/start-<process>.ts logic khởi động/tắt, test gọi trực tiếp
 *   runtime/                    vòng đời chung (runProcess, loadEnvOrExit)
 *
 * Barrel này chỉ gom phần test được; `main.ts` không bao giờ được export hay import.
 */
export * from './api/index.ts';
export * from './runtime/index.ts';
export * from './scheduler/index.ts';
export * from './worker/index.ts';
