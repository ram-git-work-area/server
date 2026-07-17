import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from '@roundz/errors';
import { validate } from '@roundz/validation';
import {
  cancelTripRequestSchema,
  createTripRequestSchema,
  idParamsSchema,
  listTripsQuerySchema,
  updateStatusRequestSchema,
} from '../schemas/trip.schemas';
import type { TripService } from '../services/trip.service';

const PRIVILEGED_ROLES = ['ADMIN', 'SUPPORT'] as const;

export class TripController {
  constructor(private readonly tripService: TripService) {}

  async createTrip(request: FastifyRequest, reply: FastifyReply) {
    const body = validate(createTripRequestSchema, request.body);
    const customerId = resolveUserId(request);
    return this.run(request, reply, 'create_trip', { customerId }, async () => {
      const response = await this.tripService.createTrip(customerId, body, toContext(request));
      reply.code(201);
      return response;
    });
  }

  async getTrip(request: FastifyRequest, reply: FastifyReply) {
    const params = validate(idParamsSchema, request.params);
    const requesterId = resolveUserId(request);
    const isPrivileged = hasPrivilegedRole(request);
    return this.run(
      request,
      reply,
      'get_trip',
      { tripId: params.id, customerId: requesterId },
      () => this.tripService.getTrip(params.id, requesterId, isPrivileged),
    );
  }

  async listTrips(request: FastifyRequest, reply: FastifyReply) {
    const query = validate(listTripsQuerySchema, request.query);
    const customerId = resolveUserId(request);
    return this.run(request, reply, 'list_trips', { customerId }, () =>
      this.tripService.listTrips(customerId, query),
    );
  }

  async cancelTrip(request: FastifyRequest, reply: FastifyReply) {
    const params = validate(idParamsSchema, request.params);
    const body = validate(cancelTripRequestSchema, request.body);
    const customerId = resolveUserId(request);
    return this.run(request, reply, 'cancel_trip', { tripId: params.id, customerId }, () =>
      this.tripService.cancelTrip(customerId, params.id, body, toContext(request)),
    );
  }

  async updateStatus(request: FastifyRequest, reply: FastifyReply) {
    const params = validate(idParamsSchema, request.params);
    const body = validate(updateStatusRequestSchema, request.body);
    return this.run(request, reply, 'update_trip_status', { tripId: params.id }, () =>
      this.tripService.updateStatus(params.id, body, toContext(request)),
    );
  }

  private async run<T>(
    request: FastifyRequest,
    reply: FastifyReply,
    operation: string,
    meta: { tripId?: string; customerId?: string },
    handler: () => Promise<T>,
  ) {
    const startedAt = process.hrtime.bigint();

    try {
      const result = await handler();
      const latencyMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      request.log.info(
        {
          requestId: request.id,
          traceId: request.headers['x-trace-id'] ?? request.id,
          operation,
          ...meta,
          latencyMs,
        },
        'trip service operation completed',
      );
      return reply.send(result);
    } catch (error) {
      const latencyMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      request.log.error(
        {
          err: error,
          requestId: request.id,
          traceId: request.headers['x-trace-id'] ?? request.id,
          operation,
          ...meta,
          latencyMs,
        },
        'trip service operation failed',
      );
      throw error;
    }
  }
}

function resolveUserId(request: FastifyRequest) {
  if (!request.authUser) {
    throw new AppError('Authentication required', 401, 'AUTH_REQUIRED');
  }

  return request.authUser.sub;
}

function hasPrivilegedRole(request: FastifyRequest) {
  return PRIVILEGED_ROLES.includes(request.authUser?.role as (typeof PRIVILEGED_ROLES)[number]);
}

function toContext(request: FastifyRequest) {
  return {
    requestId: request.id,
    traceId: (request.headers['x-trace-id'] as string | undefined) ?? request.id,
  };
}
