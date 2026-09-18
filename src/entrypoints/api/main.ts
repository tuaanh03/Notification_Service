import { buildApplication, createContainer } from '../../composition/index.ts';
import { startApi } from './start-api.ts';
import { runProcess } from '../runtime/lifecycle.ts';
import { loadEnvOrExit } from '../runtime/load-env-or-exit.ts';

const container = createContainer(loadEnvOrExit());
const application = buildApplication(container);
await runProcess({ name: 'api', container, start: () => startApi(container, application) });
