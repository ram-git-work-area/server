import type { FastifyPluginAsync } from 'fastify';
import {
  connectMongo,
  connectPostgres,
  disconnectMongo,
  disconnectPostgres,
} from '@roundz/database';
import { connectRedis, disconnectRedis } from '@roundz/redis';

export type DependenciesPluginOptions = {
  enabled: boolean;
  mongoUrl: string;
  redisUrl: string;
};

export const dependenciesPlugin: FastifyPluginAsync<DependenciesPluginOptions> = async (
  app,
  options,
) => {
  if (!options.enabled) {
    app.log.info('external dependency connections disabled for local scaffold startup');
    return;
  }

  const postgres = await connectPostgres();
  const mongo = await connectMongo(options.mongoUrl);
  const redis = await connectRedis(options.redisUrl);

  app.decorate('postgres', postgres);
  app.decorate('mongo', mongo);
  app.decorate('redis', redis);

  app.addHook('onClose', async () => {
    await disconnectRedis(redis);
    await disconnectMongo();
    await disconnectPostgres();
  });
};
