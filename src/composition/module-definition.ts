import type { HttpSurfaces } from '../shared/http/index.ts';
import type { Job } from '../shared/jobs/index.ts';
import type { ConsumerRegistration } from './consumer-registry.ts';

/**
 * Những gì một module CẮM vào ba process. Module không tự đăng ký vào Fastify / Redis / timer —
 * nó chỉ khai ra đây, process đọc và gắn:
 *
 *   http       -> process api       (theo bề mặt: public / admin / v1, server lo xác thực)
 *   consumers  -> process worker    (mỗi phần tử một consumer group)
 *   jobs       -> process scheduler (mỗi phần tử một việc định kỳ)
 */
export interface ModuleDefinition {
  name: string;
  http?: HttpSurfaces | undefined;
  consumers?: readonly ConsumerRegistration[] | undefined;
  jobs?: readonly Job[] | undefined;
}
