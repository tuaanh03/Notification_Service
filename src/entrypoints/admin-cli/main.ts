import { runAdminCli } from './run-admin-cli.ts';
import { loadEnvOrExit } from '../runtime/load-env-or-exit.ts';

/**
 * `node dist/src/entrypoints/admin-cli/main.js <lệnh>` — chạy trong container api.
 * Xem `run-admin-cli.ts` để biết vì sao việc tạo admin KHÔNG đi qua HTTP.
 */
process.exitCode = await runAdminCli(loadEnvOrExit(), process.argv.slice(2));
