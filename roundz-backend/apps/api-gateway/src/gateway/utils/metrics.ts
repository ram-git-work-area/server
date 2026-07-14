import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

export class GatewayMetrics {
  public readonly registry = new Registry();
  public readonly requestDuration: Histogram<string>;
  public readonly requestCount: Counter<string>;
  public readonly upstreamFailures: Counter<string>;
  public readonly circuitState: Gauge<string>;

  constructor() {
    collectDefaultMetrics({ register: this.registry, prefix: 'roundz_gateway_' });

    this.requestDuration = new Histogram({
      name: 'roundz_gateway_request_duration_seconds',
      help: 'Gateway request duration in seconds',
      labelNames: ['method', 'service', 'status_code'],
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
      registers: [this.registry],
    });
    this.requestCount = new Counter({
      name: 'roundz_gateway_requests_total',
      help: 'Total gateway requests',
      labelNames: ['method', 'service', 'status_code'],
      registers: [this.registry],
    });
    this.upstreamFailures = new Counter({
      name: 'roundz_gateway_upstream_failures_total',
      help: 'Total upstream failures observed by the gateway',
      labelNames: ['service', 'reason'],
      registers: [this.registry],
    });
    this.circuitState = new Gauge({
      name: 'roundz_gateway_circuit_state',
      help: 'Circuit breaker state by service: closed=0, half-open=0.5, open=1',
      labelNames: ['service'],
      registers: [this.registry],
    });
  }

  setCircuitState(service: string, state: 'closed' | 'open' | 'half-open') {
    this.circuitState.set({ service }, state === 'open' ? 1 : state === 'half-open' ? 0.5 : 0);
  }
}
