import Redis from 'ioredis';

export function createRedisClient(redisUrl: string) {
  return new Redis(redisUrl, {
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    lazyConnect: true,
  });
}

export async function connectRedis(redisUrl: string) {
  const redis = createRedisClient(redisUrl);
  await redis.connect();
  return redis;
}

export async function disconnectRedis(redis: Redis) {
  await redis.quit();
}
