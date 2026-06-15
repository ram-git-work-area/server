import type { FastifyReply, FastifyRequest } from 'fastify';
import { validate } from '@roundz/validation';
import { loginRequestSchema } from '../schemas/login.schema';
import type { AuthService } from '../services/auth.service';

export class AuthController {
  constructor(private readonly authService: AuthService) {}

  async login(request: FastifyRequest, reply: FastifyReply) {
    const body = validate(loginRequestSchema, request.body);
    const response = await this.authService.login(body);
    return reply.send(response);
  }
}
