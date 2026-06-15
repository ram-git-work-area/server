import type { FastifyInstance } from 'fastify';
import { JwtTokenService } from '@roundz/auth';
import { loadConfig } from '@roundz/config';
import { AuthController } from '../controllers/auth.controller';
import { AuthService } from '../services/auth.service';

export async function authRoutes(app: FastifyInstance) {
  const config = loadConfig({ serviceName: 'auth-service', defaultPort: 3001 });
  const controller = new AuthController(new AuthService(new JwtTokenService(config.jwtSecret)));

  app.post('/auth/login', (request, reply) => controller.login(request, reply));
}
