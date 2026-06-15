import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from '@roundz/errors';
import { validate } from '@roundz/validation';
import {
  changePasswordRequestSchema,
  forgotPasswordRequestSchema,
  loginRequestSchema,
  logoutRequestSchema,
  otpRequestSchema,
  otpVerifyRequestSchema,
  refreshRequestSchema,
  registerRequestSchema,
  verifyEmailRequestSchema,
} from '../schemas/auth.schemas';
import type { AuthService } from '../services/auth.service';

export class AuthController {
  constructor(private readonly authService: AuthService) {}

  async register(request: FastifyRequest, reply: FastifyReply) {
    const body = validate(registerRequestSchema, request.body);
    const response = await this.authService.register(body, toContext(request));
    return reply.code(201).send(response);
  }

  async login(request: FastifyRequest, reply: FastifyReply) {
    const body = validate(loginRequestSchema, request.body);
    const response = await this.authService.login(body, toContext(request));
    return reply.send(response);
  }

  async refresh(request: FastifyRequest, reply: FastifyReply) {
    const body = validate(refreshRequestSchema, request.body);
    const response = await this.authService.refresh(body, toContext(request));
    return reply.send(response);
  }

  async logout(request: FastifyRequest, reply: FastifyReply) {
    const body = validate(logoutRequestSchema, request.body ?? {});
    const response = await this.authService.logout(body, request.authUser);
    return reply.send(response);
  }

  async requestOtp(request: FastifyRequest, reply: FastifyReply) {
    const body = validate(otpRequestSchema, request.body);
    const response = await this.authService.requestOtp(body, toContext(request));
    return reply.accepted().send(response);
  }

  async verifyOtp(request: FastifyRequest, reply: FastifyReply) {
    const body = validate(otpVerifyRequestSchema, request.body);
    const response = await this.authService.verifyOtp(body, toContext(request));
    return reply.send(response);
  }

  async me(request: FastifyRequest, reply: FastifyReply) {
    const authUser = requireAuthUser(request);
    const response = await this.authService.me(authUser);
    return reply.send(response);
  }

  async changePassword(request: FastifyRequest, reply: FastifyReply) {
    const authUser = requireAuthUser(request);
    const body = validate(changePasswordRequestSchema, request.body);
    const response = await this.authService.changePassword(authUser, body, toContext(request));
    return reply.send(response);
  }

  async forgotPassword(request: FastifyRequest, reply: FastifyReply) {
    const body = validate(forgotPasswordRequestSchema, request.body);
    const response = await this.authService.forgotPassword(body);
    return reply.accepted().send(response);
  }

  async verifyEmail(request: FastifyRequest, reply: FastifyReply) {
    const body = validate(verifyEmailRequestSchema, request.body);
    const response = await this.authService.verifyEmail(body);
    return reply.send(response);
  }
}

function toContext(request: FastifyRequest) {
  const userAgent = request.headers['user-agent'];

  return {
    requestId: request.id,
    ipAddress: request.ip,
    userAgent: Array.isArray(userAgent) ? userAgent.join(',') : userAgent,
  };
}

function requireAuthUser(request: FastifyRequest) {
  if (!request.authUser) {
    throw new AppError('Authentication required', 401, 'AUTH_REQUIRED');
  }

  return request.authUser;
}
