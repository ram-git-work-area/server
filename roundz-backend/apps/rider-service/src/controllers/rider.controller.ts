import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from '@roundz/errors';
import { validate } from '@roundz/validation';
import {
  createVehicleRequestSchema,
  idParamsSchema,
  paginationQuerySchema,
  updatePreferencesRequestSchema,
  updateProfileRequestSchema,
  updateStatusRequestSchema,
  updateVehicleRequestSchema,
  uploadDocumentRequestSchema,
} from '../schemas/rider.schemas';
import type { RiderService } from '../services/rider.service';

export class RiderController {
  constructor(private readonly riderService: RiderService) {}

  async getProfile(request: FastifyRequest, reply: FastifyReply) {
    return this.withLogging(request, reply, 'get_rider_profile', (userId) =>
      this.riderService.getProfile(userId),
    );
  }

  async updateProfile(request: FastifyRequest, reply: FastifyReply) {
    const body = validate(updateProfileRequestSchema, request.body);
    return this.withLogging(request, reply, 'update_rider_profile', (userId) =>
      this.riderService.updateProfile(userId, body, toContext(request)),
    );
  }

  async getStatus(request: FastifyRequest, reply: FastifyReply) {
    return this.withLogging(request, reply, 'get_rider_status', (userId) =>
      this.riderService.getStatus(userId),
    );
  }

  async updateStatus(request: FastifyRequest, reply: FastifyReply) {
    const body = validate(updateStatusRequestSchema, request.body);
    return this.withLogging(request, reply, 'update_rider_status', (userId) =>
      this.riderService.updateStatus(userId, body, toContext(request)),
    );
  }

  async listVehicles(request: FastifyRequest, reply: FastifyReply) {
    const query = validate(paginationQuerySchema, request.query);
    return this.withLogging(request, reply, 'list_rider_vehicles', (userId) =>
      this.riderService.listVehicles(userId, query),
    );
  }

  async createVehicle(request: FastifyRequest, reply: FastifyReply) {
    const body = validate(createVehicleRequestSchema, request.body);
    return this.withLogging(request, reply, 'create_rider_vehicle', async (userId) => {
      const response = await this.riderService.createVehicle(userId, body, toContext(request));
      reply.code(201);
      return response;
    });
  }

  async updateVehicle(request: FastifyRequest, reply: FastifyReply) {
    const params = validate(idParamsSchema, request.params);
    const body = validate(updateVehicleRequestSchema, request.body);
    return this.withLogging(request, reply, 'update_rider_vehicle', (userId) =>
      this.riderService.updateVehicle(userId, params.id, body, toContext(request)),
    );
  }

  async deleteVehicle(request: FastifyRequest, reply: FastifyReply) {
    const params = validate(idParamsSchema, request.params);
    return this.withLogging(request, reply, 'delete_rider_vehicle', (userId) =>
      this.riderService.deleteVehicle(userId, params.id, toContext(request)),
    );
  }

  async setPrimaryVehicle(request: FastifyRequest, reply: FastifyReply) {
    const params = validate(idParamsSchema, request.params);
    return this.withLogging(request, reply, 'set_primary_rider_vehicle', (userId) =>
      this.riderService.setPrimaryVehicle(userId, params.id, toContext(request)),
    );
  }

  async listDocuments(request: FastifyRequest, reply: FastifyReply) {
    const query = validate(paginationQuerySchema, request.query);
    return this.withLogging(request, reply, 'list_rider_documents', (userId) =>
      this.riderService.listDocuments(userId, query),
    );
  }

  async uploadDocument(request: FastifyRequest, reply: FastifyReply) {
    const upload = await readDocumentUpload(request);

    return this.withLogging(request, reply, 'upload_rider_document', async (userId) => {
      const response = await this.riderService.uploadDocument(userId, upload, toContext(request));
      reply.code(201);
      return response;
    });
  }

  async deleteDocument(request: FastifyRequest, reply: FastifyReply) {
    const params = validate(idParamsSchema, request.params);
    return this.withLogging(request, reply, 'delete_rider_document', (userId) =>
      this.riderService.deleteDocument(userId, params.id, toContext(request)),
    );
  }

  async getPreferences(request: FastifyRequest, reply: FastifyReply) {
    return this.withLogging(request, reply, 'get_rider_preferences', (userId) =>
      this.riderService.getPreferences(userId),
    );
  }

  async updatePreferences(request: FastifyRequest, reply: FastifyReply) {
    const body = validate(updatePreferencesRequestSchema, request.body);
    return this.withLogging(request, reply, 'update_rider_preferences', (userId) =>
      this.riderService.updatePreferences(userId, body, toContext(request)),
    );
  }

  private async withLogging<T>(
    request: FastifyRequest,
    reply: FastifyReply,
    operation: string,
    handler: (userId: string) => Promise<T>,
  ) {
    const startedAt = process.hrtime.bigint();
    const userId = requireRiderUserId(request);

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
        'rider service operation completed',
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
        'rider service operation failed',
      );
      throw error;
    }
  }
}

async function readDocumentUpload(request: FastifyRequest) {
  let documentType: string | undefined;
  let fileName: string | undefined;
  let contentType: string | undefined;
  let body: Buffer | undefined;

  const parts = request.parts();
  for await (const part of parts) {
    if (part.type === 'file') {
      body = await part.toBuffer();
      fileName = part.filename;
      contentType = part.mimetype;
    } else if (part.fieldname === 'documentType' && typeof part.value === 'string') {
      documentType = part.value;
    }
  }

  if (!body || !fileName || !contentType) {
    throw new AppError('Document file is required', 400, 'RIDER_DOCUMENT_FILE_REQUIRED');
  }

  const metadata = validate(uploadDocumentRequestSchema, {
    documentType,
    fileName,
    contentType,
    sizeBytes: body.byteLength,
  });

  return { ...metadata, body };
}

function requireRiderUserId(request: FastifyRequest) {
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
