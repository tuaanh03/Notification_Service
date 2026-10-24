import { z } from 'zod';
import type { CommandContext } from '../../../../shared/application/index.ts';
import { access, adminCaller, doc, parseInput, type HttpRoutes } from '../../../../shared/http/index.ts';
import {
  MAX_DEAD_LETTERS,
  MAX_DISCARD_REASON,
  type DiscardDeadLetter,
  type QueueQueries,
  type RequeueDeadLetter,
  type SetGroupPaused,
} from '../../application/index.ts';

/** Tên stream / group: chữ thường, số, chấm, gạch — đúng khuôn `STREAMS` (không nhận ký tự lạ vào lệnh Redis). */
const NAME = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,99}$/);
/** Id entry của Redis Stream: `<ms>-<seq>`. */
const ENTRY_ID = z.string().regex(/^\d{1,20}-\d{1,20}$/);

const deadLettersQuery = z.object({
  stream: NAME.optional(),
  limit: z.coerce.number().int().min(1).max(MAX_DEAD_LETTERS).default(100),
});
const letterParams = z.object({ stream: NAME, id: ENTRY_ID });
const discardBody = z.object({ reason: z.string().max(MAX_DISCARD_REASON) }).strict();
const groupParams = z.object({ group: NAME });
const pauseBody = z.object({ paused: z.boolean() }).strict();

const ctx = (request: Parameters<typeof adminCaller>[0]): CommandContext => ({
  actor: { id: adminCaller(request).adminId, type: 'admin' },
  source: 'admin_api',
});

/** Hàng đợi (Redis Streams) — chỉ Super Admin (`platform.manage`, ADR-0042). */
export function adminQueuesRoutes(useCases: {
  queries: QueueQueries;
  requeue: RequeueDeadLetter;
  discard: DiscardDeadLetter;
  setPaused: SetGroupPaused;
}): HttpRoutes {
  return (app) => {
    const tag = 'queues';
    const manage = access('platform.manage');

    app.get(
      '/queues',
      {
        config: {
          ...manage,
          ...doc({ tag, summary: 'Get every processing group: pending, in flight, dead letters, running workers, paused or not (Super Admin only).', responseDto: 'QueuesDto' }),
        },
      },
      async () => useCases.queries.overview(),
    );

    app.get(
      '/queues/dead-letters',
      {
        config: {
          ...manage,
          ...doc({
            tag,
            summary: 'List dead-lettered messages, newest first, optionally of one stream (Super Admin only).',
            description: 'Only the kind of work and the first characters of the target id — never the message content.',
            query: deadLettersQuery,
            responseDto: 'DeadLetterDto',
          }),
        },
      },
      async (request) => {
        const query = parseInput(deadLettersQuery, request.query);
        return { items: await useCases.queries.deadLetters(query) };
      },
    );

    app.post(
      '/queues/dead-letters/:stream/:id/requeue',
      {
        config: {
          ...manage,
          ...doc({ tag, summary: 'Put one dead-lettered message back on its stream to be processed again (Super Admin only).', params: letterParams, errors: [{ status: 404, code: 'NOT_FOUND' }] }),
        },
      },
      async (request) => {
        const params = parseInput(letterParams, request.params);
        return useCases.requeue.execute(params, ctx(request));
      },
    );

    app.post(
      '/queues/dead-letters/:stream/:id/discard',
      {
        config: {
          ...manage,
          ...doc({
            tag,
            summary: 'Drop one dead-lettered message for good, with a reason that goes to the audit log (Super Admin only).',
            params: letterParams,
            body: discardBody,
            example: { reason: 'Recipient deleted; message no longer applies.' },
            status: 204,
            errors: [
              { status: 404, code: 'NOT_FOUND' },
              { status: 422, code: 'DISCARD_REASON_REQUIRED' },
              { status: 422, code: 'DISCARD_REASON_TOO_LONG' },
            ],
          }),
        },
      },
      async (request, reply) => {
        const params = parseInput(letterParams, request.params);
        const body = parseInput(discardBody, request.body);
        await useCases.discard.execute({ ...params, reason: body.reason }, ctx(request));
        return reply.status(204).send();
      },
    );

    app.put(
      '/queues/groups/:group/pause',
      {
        config: {
          ...manage,
          ...doc({
            tag,
            summary: 'Pause or resume one processing group; a paused group stops taking new messages (Super Admin only).',
            params: groupParams,
            body: pauseBody,
            example: { paused: true },
            errors: [{ status: 422, code: 'CONSUMER_NOT_PAUSABLE' }],
          }),
        },
      },
      async (request) => {
        const { group } = parseInput(groupParams, request.params);
        const body = parseInput(pauseBody, request.body);
        return useCases.setPaused.execute({ group, paused: body.paused }, ctx(request));
      },
    );
  };
}
