import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from '@roundz/errors';
import { validate } from '@roundz/validation';
import {
  createAddressRequestSchema,
  createFavoriteLocationRequestSchema,
  idParamsSchema,
  paginationQuerySchema,
  profileImageUploadSchema,
  updateAddressRequestSchema,
  updateEmergencyContactRequestSchema,
  updateFavoriteLocationRequestSchema,
  updateProfileRequestSchema,
  updateSettingsRequestSchema,
} from '../schemas/user.schemas';
import type { UserService } from '../services/user.service';

export class UserController {
  constructor(private readonly userService: UserService) {}

  async getProfile(request: FastifyRequest, reply: FastifyReply) {
    return this.withLogging(request, reply, 'get_user_profile', (userId) =>
      this.userService.getProfile(userId),
    );
  }

  async updateProfile(request: FastifyRequest, reply: FastifyReply) {
    const body = validate(updateProfileRequestSchema, request.body);
    return this.withLogging(request, reply, 'update_user_profile', (userId) =>
      this.userService.updateProfile(userId, body, toContext(request)),
    );
  }

  async uploadProfileImage(request: FastifyRequest, reply: FastifyReply) {
    const file = await request.file();

    if (!file) {
      throw new AppError('Profile image file is required', 400, 'USER_PROFILE_IMAGE_REQUIRED');
    }

    const body = await file.toBuffer();
    const metadata = validate(profileImageUploadSchema, {
      fileName: file.filename,
      contentType: file.mimetype,
      sizeBytes: body.byteLength,
    });

    return this.withLogging(request, reply, 'upload_user_profile_image', (userId) =>
      this.userService.uploadProfileImage(
        userId,
        {
          ...metadata,
          body,
        },
        toContext(request),
      ),
    );
  }

  async deleteProfileImage(request: FastifyRequest, reply: FastifyReply) {
    return this.withLogging(request, reply, 'delete_user_profile_image', (userId) =>
      this.userService.deleteProfileImage(userId, toContext(request)),
    );
  }

  async listAddresses(request: FastifyRequest, reply: FastifyReply) {
    const query = validate(paginationQuerySchema, request.query);
    return this.withLogging(request, reply, 'list_user_addresses', (userId) =>
      this.userService.listAddresses(userId, query),
    );
  }

  async createAddress(request: FastifyRequest, reply: FastifyReply) {
    const body = validate(createAddressRequestSchema, request.body);
    return this.withLogging(request, reply, 'create_user_address', async (userId) => {
      const response = await this.userService.createAddress(userId, body, toContext(request));
      reply.code(201);
      return response;
    });
  }

  async updateAddress(request: FastifyRequest, reply: FastifyReply) {
    const params = validate(idParamsSchema, request.params);
    const body = validate(updateAddressRequestSchema, request.body);
    return this.withLogging(request, reply, 'update_user_address', (userId) =>
      this.userService.updateAddress(userId, params.id, body, toContext(request)),
    );
  }

  async deleteAddress(request: FastifyRequest, reply: FastifyReply) {
    const params = validate(idParamsSchema, request.params);
    return this.withLogging(request, reply, 'delete_user_address', (userId) =>
      this.userService.deleteAddress(userId, params.id, toContext(request)),
    );
  }

  async setDefaultAddress(request: FastifyRequest, reply: FastifyReply) {
    const params = validate(idParamsSchema, request.params);
    return this.withLogging(request, reply, 'set_default_user_address', (userId) =>
      this.userService.setDefaultAddress(userId, params.id, toContext(request)),
    );
  }

  async listFavorites(request: FastifyRequest, reply: FastifyReply) {
    const query = validate(paginationQuerySchema, request.query);
    return this.withLogging(request, reply, 'list_user_favorites', (userId) =>
      this.userService.listFavoriteLocations(userId, query),
    );
  }

  async createFavorite(request: FastifyRequest, reply: FastifyReply) {
    const body = validate(createFavoriteLocationRequestSchema, request.body);
    return this.withLogging(request, reply, 'create_user_favorite', async (userId) => {
      const response = await this.userService.createFavoriteLocation(
        userId,
        body,
        toContext(request),
      );
      reply.code(201);
      return response;
    });
  }

  async updateFavorite(request: FastifyRequest, reply: FastifyReply) {
    const params = validate(idParamsSchema, request.params);
    const body = validate(updateFavoriteLocationRequestSchema, request.body);
    return this.withLogging(request, reply, 'update_user_favorite', (userId) =>
      this.userService.updateFavoriteLocation(userId, params.id, body, toContext(request)),
    );
  }

  async deleteFavorite(request: FastifyRequest, reply: FastifyReply) {
    const params = validate(idParamsSchema, request.params);
    return this.withLogging(request, reply, 'delete_user_favorite', (userId) =>
      this.userService.deleteFavoriteLocation(userId, params.id, toContext(request)),
    );
  }

  async getSettings(request: FastifyRequest, reply: FastifyReply) {
    return this.withLogging(request, reply, 'get_user_settings', (userId) =>
      this.userService.getSettings(userId),
    );
  }

  async updateSettings(request: FastifyRequest, reply: FastifyReply) {
    const body = validate(updateSettingsRequestSchema, request.body);
    return this.withLogging(request, reply, 'update_user_settings', (userId) =>
      this.userService.updateSettings(userId, body, toContext(request)),
    );
  }

  async updateEmergencyContact(request: FastifyRequest, reply: FastifyReply) {
    const body = validate(updateEmergencyContactRequestSchema, request.body);
    return this.withLogging(request, reply, 'update_user_emergency_contact', (userId) =>
      this.userService.updateEmergencyContact(userId, body, toContext(request)),
    );
  }

  private async withLogging<T>(
    request: FastifyRequest,
    reply: FastifyReply,
    operation: string,
    handler: (userId: string) => Promise<T>,
  ) {
    const startedAt = process.hrtime.bigint();
    const userId = requireCustomerUserId(request);

    try {
      const result = await handler(userId);
      const latencyMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      request.log.info(
        {
          requestId: request.id,
          traceId: request.headers['x-trace-id'] ?? request.id,
          userId,
          operation,
          latencyMs,
        },
        'user service operation completed',
      );
      return reply.send(result);
    } catch (error) {
      const latencyMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      request.log.error(
        {
          err: error,
          requestId: request.id,
          traceId: request.headers['x-trace-id'] ?? request.id,
          userId,
          operation,
          latencyMs,
        },
        'user service operation failed',
      );
      throw error;
    }
  }
}

function requireCustomerUserId(request: FastifyRequest) {
  if (!request.authUser) {
    throw new AppError('Authentication required', 401, 'AUTH_REQUIRED');
  }

  return request.authUser.sub;
}

function toContext(request: FastifyRequest) {
  return {
    requestId: request.id,
    traceId: (request.headers['x-trace-id'] as string | undefined) ?? request.id,
  };
}
