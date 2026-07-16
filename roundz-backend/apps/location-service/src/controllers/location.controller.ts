import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from '@roundz/errors';
import { validate } from '@roundz/validation';
import {
  historyQuerySchema,
  nearbyQuerySchema,
  riderIdParamsSchema,
  updateLocationRequestSchema,
} from '../schemas/location.schemas';
import type { LocationService } from '../services/location.service';

const ADMIN_ROLES = ['ADMIN', 'SUPPORT'] as const;

export class LocationController {
  constructor(private readonly locationService: LocationService) {}

  async updateLocation(request: FastifyRequest, reply: FastifyReply) {
    const body = validate(updateLocationRequestSchema, request.body);
    const riderId = resolveRiderId(request);
    return this.run(request, reply, 'update_location', riderId, () =>
      this.locationService.updateLocation(riderId, body, toContext(request)),
    );
  }

  async heartbeat(request: FastifyRequest, reply: FastifyReply) {
    const riderId = resolveRiderId(request);
    return this.run(request, reply, 'location_heartbeat', riderId, () =>
      this.locationService.heartbeat(riderId, toContext(request)),
    );
  }

  async getCurrent(request: FastifyRequest, reply: FastifyReply) {
    const riderId = resolveRiderId(request);
    return this.run(request, reply, 'get_current_location', riderId, () =>
      this.locationService.getCurrent(riderId),
    );
  }

  async getRiderCurrent(request: FastifyRequest, reply: FastifyReply) {
    const params = validate(riderIdParamsSchema, request.params);
    return this.run(request, reply, 'get_rider_current_location', params.riderId, () =>
      this.locationService.getRiderCurrent(params.riderId),
    );
  }

  async getNearby(request: FastifyRequest, reply: FastifyReply) {
    const query = validate(nearbyQuerySchema, request.query);
    const riderId = resolveRiderId(request);
    return this.run(request, reply, 'get_nearby_riders', riderId, () =>
      this.locationService.getNearby(query),
    );
  }

  async getHistory(request: FastifyRequest, reply: FastifyReply) {
    const query = validate(historyQuerySchema, request.query);
    const riderId = resolveRiderId(request);
    const canQueryOthers = ADMIN_ROLES.includes(
      request.authUser?.role as (typeof ADMIN_ROLES)[number],
    );
    return this.run(request, reply, 'get_location_history', riderId, () =>
      this.locationService.getHistory(query, riderId, canQueryOthers),
    );
  }

  private async run<T>(
    request: FastifyRequest,
    reply: FastifyReply,
    operation: string,
    riderId: string,
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
          riderId,
          operation,
          latencyMs,
        },
        'location service operation completed',
      );
      return reply.send(result);
    } catch (error) {
      const latencyMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      request.log.error(
        {
          err: error,
          requestId: request.id,
          traceId: request.headers['x-trace-id'] ?? request.id,
          riderId,
          operation,
          latencyMs,
        },
        'location service operation failed',
      );
      throw error;
    }
  }
}

function resolveRiderId(request: FastifyRequest) {
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
