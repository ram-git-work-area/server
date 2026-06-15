import { registerGracefulShutdown } from '@roundz/common';
import { buildApp } from './app';

async function start() {
  const { app, config } = await buildApp();

  registerGracefulShutdown(app);

  await app.listen({ host: '0.0.0.0', port: config.port });
}

void start().catch((error) => {
  console.error(error);
  process.exit(1);
});
