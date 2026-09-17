export class ILogger {
  debug(_msg, _meta) { throw new Error('ILogger.debug not implemented'); }
  info(_msg, _meta) { throw new Error('ILogger.info not implemented'); }
  warn(_msg, _meta) { throw new Error('ILogger.warn not implemented'); }
  error(_msg, _meta) { throw new Error('ILogger.error not implemented'); }
}
