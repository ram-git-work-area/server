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
  updatePreferredLanguageRequestSchema,
  updateProfileRequestSchema,
} from '../schemas/user.schemas';
import type { UserService } from '../services/user.service';

export class UserController {
  constructor(private readonly userService: UserService) {}

  async getProfile(request: FastifyRequest, reply: FastifyReply) {
    const userId = requireCustomerUserId(request);
    request.log.info({ userId, requestId: request.id }, 'fetching user profile');
    return reply.send(await this.userService.getProfile(userId));
  }

  async updateProfile(request: FastifyRequest, reply: FastifyReply) {
    const userId = requireCustomerUserId(request);
    const body = validate(updateProfileRequestSchema, request.body);
    request.log.info({ userId, requestId: request.id }, 'updating user profile');
    return reply.send(await this.userService.updateProfile(userId, body, toContext(request)));
  }

  async uploadProfileImage(request: FastifyRequest, reply: FastifyReply) {
    const userId = requireCustomerUserId(request);
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

    request.log.info(
      {
        userId,
        requestId: request.id,
        contentType: metadata.contentType,
        sizeBytes: metadata.sizeBytes,
      },
      'uploading user profile image',
    );

    return reply.send(
      await this.userService.uploadProfileImage(
        userId,
        {
          ...metadata,
          body,
        },
        toContext(request),
      ),
    );
  }

  async listAddresses(request: FastifyRequest, reply: FastifyReply) {
    const userId = requireCustomerUserId(request);
    const query = validate(paginationQuerySchema, request.query);
    return reply.send(await this.userService.listAddresses(userId, query));
  }

  async createAddress(request: FastifyRequest, reply: FastifyReply) {
    const userId = requireCustomerUserId(request);
    const body = validate(createAddressRequestSchema, request.body);
    request.log.info({ userId, requestId: request.id }, 'creating user address');
    const response = await this.userService.createAddress(userId, body, toContext(request));
    return reply.code(201).send(response);
  }

  async updateAddress(request: FastifyRequest, reply: FastifyReply) {
    const userId = requireCustomerUserId(request);
    const params = validate(idParamsSchema, request.params);
    const body = validate(updateAddressRequestSchema, request.body);
    request.log.info(
      { userId, addressId: params.id, requestId: request.id },
      'updating user address',
    );
    return reply.send(
      await this.userService.updateAddress(userId, params.id, body, toContext(request)),
    );
  }

  async deleteAddress(request: FastifyRequest, reply: FastifyReply) {
    const userId = requireCustomerUserId(request);
    const params = validate(idParamsSchema, request.params);
    request.log.info(
      { userId, addressId: params.id, requestId: request.id },
      'deleting user address',
    );
    return reply.send(await this.userService.deleteAddress(userId, params.id, toContext(request)));
  }

  async setDefaultAddress(request: FastifyRequest, reply: FastifyReply) {
    const userId = requireCustomerUserId(request);
    const params = validate(idParamsSchema, request.params);
    request.log.info(
      { userId, addressId: params.id, requestId: request.id },
      'setting default user address',
    );
    return reply.send(
      await this.userService.setDefaultAddress(userId, params.id, toContext(request)),
    );
  }

  async listFavorites(request: FastifyRequest, reply: FastifyReply) {
    const userId = requireCustomerUserId(request);
    const query = validate(paginationQuerySchema, request.query);
    return reply.send(await this.userService.listFavoriteLocations(userId, query));
  }

  async createFavorite(request: FastifyRequest, reply: FastifyReply) {
    const userId = requireCustomerUserId(request);
    const body = validate(createFavoriteLocationRequestSchema, request.body);
    request.log.info({ userId, requestId: request.id }, 'creating user favorite location');
    const response = await this.userService.createFavoriteLocation(
      userId,
      body,
      toContext(request),
    );
    return reply.code(201).send(response);
  }

  async deleteFavorite(request: FastifyRequest, reply: FastifyReply) {
    const userId = requireCustomerUserId(request);
    const params = validate(idParamsSchema, request.params);
    request.log.info(
      { userId, favoriteId: params.id, requestId: request.id },
      'deleting user favorite location',
    );
    return reply.send(
      await this.userService.deleteFavoriteLocation(userId, params.id, toContext(request)),
    );
  }

  async updatePreferredLanguage(request: FastifyRequest, reply: FastifyReply) {
    const userId = requireCustomerUserId(request);
    const body = validate(updatePreferredLanguageRequestSchema, request.body);
    request.log.info({ userId, requestId: request.id }, 'updating user preferred language');
    return reply.send(
      await this.userService.updatePreferredLanguage(userId, body, toContext(request)),
    );
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
  };
}
