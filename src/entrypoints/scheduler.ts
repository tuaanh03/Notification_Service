import { buildApplication, createContainer, moduleJobs } from '../composition/index.ts';
import { runProcess } from './lifecycle.ts';
import { loadEnvOrExit } from './load-env-or-exit.ts';
import { startScheduler } from './scheduler-process.ts';

const container = createContainer(loadEnvOrExit());
const application = buildApplication(container);
await runProcess({ name: 'scheduler', container, start: () => startScheduler(container, moduleJobs(application)) });
