import type { FastifyInstance } from 'fastify';

type ShutdownDependency = {
  name: string;
  close: () => Promise<void> | void;
};

export function registerGracefulShutdown(
  app: FastifyInstance,
  dependencies: ShutdownDependency[] = [],
) {
  const shutdown = async (signal: NodeJS.Signals) => {
    app.log.info({ signal }, 'graceful shutdown started');

    for (const dependency of dependencies) {
      try {
        await dependency.close();
        app.log.info({ dependency: dependency.name }, 'dependency closed');
      } catch (error) {
        app.log.error({ err: error, dependency: dependency.name }, 'failed to close dependency');
      }
    }

    await app.close();
    app.log.info('graceful shutdown completed');
    process.exit(0);
  };

  process.once('SIGTERM', (signal) => void shutdown(signal));
  process.once('SIGINT', (signal) => void shutdown(signal));
}
