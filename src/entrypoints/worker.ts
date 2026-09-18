import { buildApplication, consumerRegistry, createContainer } from '../composition/index.ts';
import { runProcess } from './lifecycle.ts';
import { loadEnvOrExit } from './load-env-or-exit.ts';
import { startWorker } from './worker-process.ts';

const container = createContainer(loadEnvOrExit());
const application = buildApplication(container);
await runProcess({ name: 'worker', container, start: () => startWorker(container, consumerRegistry(application)) });
