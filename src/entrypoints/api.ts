import { buildApplication, createContainer } from '../composition/index.ts';
import { startApi } from './api-process.ts';
import { runProcess } from './lifecycle.ts';
import { loadEnvOrExit } from './load-env-or-exit.ts';

const container = createContainer(loadEnvOrExit());
const application = buildApplication(container);
await runProcess({ name: 'api', container, start: () => startApi(container, application) });
