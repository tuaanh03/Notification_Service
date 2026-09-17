import { createLogger } from './shared/helpers/index.js';

const logger = createLogger();
logger.info('bootstrap', { env: process.env.NODE_ENV ?? 'development' });

// TODO: infrastructure -> container -> server
