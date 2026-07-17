import type { FastifyPluginAsync } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { connectPostgres, disconnectPostgres } from '@roundz/database';
import { connectRedis, disconnectRedis } from '@roundz/redis';
import type Redis from 'ioredis';

export type DependenciesPluginOptions = {
  enabled: boolean;
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
  const redis = await connectRedis(options.redisUrl);

  app.decorate('postgres', postgres);
  app.decorate('redis', redis);

  app.addHook('onClose', async () => {
    await disconnectRedis(redis);
    await disconnectPostgres();
  });
};

declare module 'fastify' {
  interface FastifyInstance {
    postgres: PrismaClient;
    redis: Redis;
  }
}
