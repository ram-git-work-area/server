import type { FastifyInstance } from 'fastify';
import type { SignOptions } from 'jsonwebtoken';
import { loadConfig } from '@roundz/config';
import { createPostgresClient } from '@roundz/database';
import { AuthController } from '../controllers/auth.controller';
import { authenticate } from '../plugins/auth.middleware';
import { AuthRepository } from '../repositories/auth.repository';
import {
  KafkaAuthEventPublisher,
  NoopAuthEventPublisher,
  type AuthEventPublisher,
} from '../services/auth-events.publisher';
import { AuthService } from '../services/auth.service';
import { NoopAuthNotificationProvider } from '../services/notification.provider';
import { NoopAuthRateLimiter, RedisAuthRateLimiter } from '../services/rate-limiter.service';

export async function authRoutes(app: FastifyInstance) {
  const config = loadConfig({ serviceName: 'auth-service', defaultPort: 3001 });
  const repository = new AuthRepository(
    app.hasDecorator('postgres') ? app.postgres : createPostgresClient(),
  );
  const rateLimiter = app.hasDecorator('redis')
    ? new RedisAuthRateLimiter(app.redis)
    : new NoopAuthRateLimiter();
  const eventPublisher = await createEventPublisher(app, config);
  const controller = new AuthController(
    new AuthService({
      repository,
      jwtSecret: config.jwtSecret,
      accessTokenExpiresIn: config.jwtAccessTokenExpiresIn as SignOptions['expiresIn'],
      refreshTokenExpiresIn: config.jwtRefreshTokenExpiresIn as SignOptions['expiresIn'],
      accessTokenTtlSeconds: config.jwtAccessTokenTtlSeconds,
      refreshTokenTtlSeconds: config.jwtRefreshTokenTtlSeconds,
      loginRateLimitMax: config.authLoginRateLimitMax,
      loginRateLimitWindowSeconds: config.authLoginRateLimitWindowSeconds,
      otpRateLimitMax: config.authOtpRateLimitMax,
      otpRateLimitWindowSeconds: config.authOtpRateLimitWindowSeconds,
      otpTtlSeconds: config.authOtpTtlSeconds,
      rateLimiter,
      eventPublisher,
      notificationProvider: new NoopAuthNotificationProvider(),
    }),
  );
  const requireAccessToken = authenticate(config.jwtSecret);

  app.post('/auth/register', (request, reply) => controller.register(request, reply));
  app.post('/auth/login', (request, reply) => controller.login(request, reply));
  app.post('/auth/refresh', (request, reply) => controller.refresh(request, reply));
  app.post('/auth/logout', { preHandler: [requireAccessToken] }, (request, reply) =>
    controller.logout(request, reply),
  );
  app.post('/auth/otp/request', (request, reply) => controller.requestOtp(request, reply));
  app.post('/auth/otp/verify', (request, reply) => controller.verifyOtp(request, reply));
  app.get('/auth/me', { preHandler: [requireAccessToken] }, (request, reply) =>
    controller.me(request, reply),
  );
  app.post('/auth/change-password', { preHandler: [requireAccessToken] }, (request, reply) =>
    controller.changePassword(request, reply),
  );
  app.post('/auth/forgot-password', (request, reply) => controller.forgotPassword(request, reply));
  app.post('/auth/verify-email', (request, reply) => controller.verifyEmail(request, reply));
}

async function createEventPublisher(
  app: FastifyInstance,
  config: ReturnType<typeof loadConfig>,
): Promise<AuthEventPublisher> {
  if (!config.enableExternalConnections) {
    return new NoopAuthEventPublisher();
  }

  const publisher = new KafkaAuthEventPublisher(config.kafkaBrokers);
  await publisher.connect();

  app.addHook('onClose', async () => {
    await publisher.close();
  });

  return publisher;
}
