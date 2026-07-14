import { Pool } from 'undici';
import type { RoundzConfig } from '@roundz/config';
import type { GatewayRoute } from '../config/route-registry';
import { CircuitBreaker } from '../utils/circuit-breaker';
import type { GatewayMetrics } from '../utils/metrics';

export type ProxyTarget = {
  route: GatewayRoute;
  pool?: Pool;
  circuitBreaker: CircuitBreaker;
};

export class ProxyRegistry {
  private readonly targets = new Map<string, ProxyTarget>();

  constructor(
    routes: GatewayRoute[],
    config: RoundzConfig,
    private readonly metrics: GatewayMetrics,
  ) {
    for (const route of routes) {
      const circuitBreaker = new CircuitBreaker(
        config.gatewayCircuitFailureThreshold,
        config.gatewayCircuitOpenMs,
      );
      const target: ProxyTarget = {
        route,
        circuitBreaker,
        ...(route.baseUrl
          ? {
              pool: new Pool(route.baseUrl, {
                connections: 1024,
                pipelining: 1,
                keepAliveTimeout: 30000,
                keepAliveMaxTimeout: 120000,
              }),
            }
          : {}),
      };

      this.targets.set(route.key, target);
      this.metrics.setCircuitState(route.serviceName, circuitBreaker.snapshot().state);
    }
  }

  get(route: GatewayRoute) {
    return this.targets.get(route.key);
  }

  list() {
    return [...this.targets.values()];
  }

  snapshot() {
    return this.list().map((target) => ({
      serviceName: target.route.serviceName,
      key: target.route.key,
      baseUrlConfigured: Boolean(target.route.baseUrl),
      circuit: target.circuitBreaker.snapshot(),
    }));
  }

  async close() {
    await Promise.all(this.list().map((target) => target.pool?.close()));
  }
}
