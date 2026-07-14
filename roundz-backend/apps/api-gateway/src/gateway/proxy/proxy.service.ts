import type { IncomingHttpHeaders } from 'node:http';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from '@roundz/errors';
import type { RoundzConfig } from '@roundz/config';
import type { GatewayRoute } from '../config/route-registry';
import type { RouteRegistry } from '../config/route-registry';
import type { ProxyRegistry, ProxyTarget } from './proxy-registry';
import type { GatewayMetrics } from '../utils/metrics';

const retryableStatusCodes = new Set([502, 503, 504]);

export class ProxyService {
  constructor(
    private readonly routeRegistry: RouteRegistry,
    private readonly proxyRegistry: ProxyRegistry,
    private readonly config: RoundzConfig,
    private readonly metrics: GatewayMetrics,
  ) {}

  async forward(request: FastifyRequest, reply: FastifyReply) {
    const route = this.routeRegistry.resolve(request.url);

    if (!route) {
      throw new AppError('Gateway route not found', 404, 'GATEWAY_ROUTE_NOT_FOUND');
    }

    const target = this.proxyRegistry.get(route);

    if (!target?.pool || !route.baseUrl) {
      throw new AppError(
        'Downstream service is not configured',
        503,
        'GATEWAY_SERVICE_UNCONFIGURED',
      );
    }

    if (!target.circuitBreaker.canRequest()) {
      this.metrics.setCircuitState(route.serviceName, target.circuitBreaker.snapshot().state);
      throw new AppError(
        'Downstream service is temporarily unavailable',
        503,
        'GATEWAY_CIRCUIT_OPEN',
      );
    }

    request.gatewayService = route.serviceName;

    const response = await this.dispatchWithRetry(target, route, request);
    reply.code(response.statusCode);

    for (const [header, value] of Object.entries(response.headers)) {
      if (shouldForwardResponseHeader(header) && value !== undefined) {
        reply.header(header, value);
      }
    }

    return reply.send(response.body);
  }

  private async dispatchWithRetry(
    target: ProxyTarget,
    route: GatewayRoute,
    request: FastifyRequest,
  ) {
    const maxAttempts =
      request.method === 'GET' ? Math.max(1, this.config.gatewayGetRetryAttempts + 1) : 1;
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const response = await this.dispatch(target, route, request);

        if (
          request.method === 'GET' &&
          attempt < maxAttempts &&
          retryableStatusCodes.has(response.statusCode)
        ) {
          target.circuitBreaker.recordFailure();
          this.metrics.upstreamFailures.inc({
            service: route.serviceName,
            reason: `status_${response.statusCode}`,
          });
          await response.body.dump();
          continue;
        }

        target.circuitBreaker.recordSuccess();
        this.metrics.setCircuitState(route.serviceName, target.circuitBreaker.snapshot().state);
        return response;
      } catch (error) {
        lastError = error;
        target.circuitBreaker.recordFailure();
        this.metrics.setCircuitState(route.serviceName, target.circuitBreaker.snapshot().state);
        this.metrics.upstreamFailures.inc({ service: route.serviceName, reason: 'network' });

        if (request.method !== 'GET' || attempt >= maxAttempts) {
          break;
        }
      }
    }

    if (isTimeoutError(lastError)) {
      throw new AppError('Gateway timeout', 504, 'GATEWAY_TIMEOUT');
    }

    throw new AppError('Downstream service is unavailable', 503, 'GATEWAY_UPSTREAM_UNAVAILABLE');
  }

  private async dispatch(target: ProxyTarget, route: GatewayRoute, request: FastifyRequest) {
    if (!target.pool) {
      throw new AppError(
        'Downstream service is not configured',
        503,
        'GATEWAY_SERVICE_UNCONFIGURED',
      );
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.gatewayRequestTimeoutMs);

    try {
      return await target.pool.request({
        method: request.method,
        path: this.routeRegistry.rewritePath(route, request.url),
        headers: buildForwardHeaders(request),
        body: buildRequestBody(request),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}

function buildRequestBody(request: FastifyRequest) {
  if (['GET', 'HEAD'].includes(request.method)) {
    return undefined;
  }

  if (Buffer.isBuffer(request.body) || typeof request.body === 'string') {
    return request.body;
  }

  if (request.body === undefined || request.body === null) {
    return undefined;
  }

  return JSON.stringify(request.body);
}

function buildForwardHeaders(request: FastifyRequest): IncomingHttpHeaders {
  const headers: IncomingHttpHeaders = {};
  const sourceHeaders = request.headers;

  for (const header of [
    'authorization',
    'content-type',
    'accept',
    'x-request-id',
    'x-trace-id',
    'x-forwarded-for',
    'x-real-ip',
  ]) {
    const value = sourceHeaders[header];
    if (value !== undefined) {
      headers[header] = value;
    }
  }

  headers['x-request-id'] = request.id;
  headers['x-trace-id'] = (sourceHeaders['x-trace-id'] as string | undefined) ?? request.id;
  headers['x-forwarded-for'] = buildForwardedFor(request);
  headers['x-real-ip'] = request.ip;

  if (request.authUser) {
    headers['x-user-id'] = request.authUser.sub;
    headers['x-user-role'] = request.authUser.role;
    headers['x-role'] = request.authUser.role;
  }

  return headers;
}

function buildForwardedFor(request: FastifyRequest) {
  const existing = request.headers['x-forwarded-for'];
  const existingValue = Array.isArray(existing) ? existing.join(', ') : existing;

  return existingValue ? `${existingValue}, ${request.ip}` : request.ip;
}

function shouldForwardResponseHeader(header: string) {
  return !['connection', 'keep-alive', 'transfer-encoding', 'upgrade'].includes(
    header.toLowerCase(),
  );
}

function isTimeoutError(error: unknown) {
  return (
    error instanceof Error &&
    (error.name === 'AbortError' || error.message.toLowerCase().includes('abort'))
  );
}

declare module 'fastify' {
  interface FastifyRequest {
    gatewayService?: string;
  }
}
