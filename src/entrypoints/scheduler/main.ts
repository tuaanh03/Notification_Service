import { buildApplication, createContainer, moduleJobs } from '../../composition/index.ts';
import { runProcess } from '../runtime/lifecycle.ts';
import { loadEnvOrExit } from '../runtime/load-env-or-exit.ts';
import { startScheduler } from './start-scheduler.ts';

const container = createContainer(loadEnvOrExit());
const application = buildApplication(container);
await runProcess({ name: 'scheduler', container, start: () => startScheduler(container, moduleJobs(application)) });
