import { buildApplication, consumerRegistry, createContainer } from '../../composition/index.ts';
import { runProcess } from '../runtime/lifecycle.ts';
import { loadEnvOrExit } from '../runtime/load-env-or-exit.ts';
import { startWorker } from './start-worker.ts';

const container = createContainer(loadEnvOrExit());
const application = buildApplication(container);
await runProcess({ name: 'worker', container, start: () => startWorker(container, consumerRegistry(application)) });
