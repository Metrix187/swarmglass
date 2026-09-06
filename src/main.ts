import { startApp } from './app.ts';

// entrypoint. `node src/main.ts` — no build step, node strips the types.

const app = await startApp();

let closing = false;
const shutdown = (signal: string) => {
  if (closing) return;
  closing = true;
  app.log.info('shutting down', { signal });
  app
    .close()
    .then(() => process.exit(0))
    .catch((e) => {
      app.log.error('shutdown failed', { err: String(e) });
      process.exit(1);
    });
  setTimeout(() => process.exit(1), 10_000).unref();
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('uncaughtException', (e) => {
  app.log.error('uncaught exception', { err: e.stack ?? String(e) });
});
process.on('unhandledRejection', (e) => {
  app.log.error('unhandled rejection', { err: e instanceof Error ? e.stack ?? e.message : String(e) });
});
