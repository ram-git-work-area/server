import type { HealthResponse } from '@roundz/common';

export class HealthService {
  constructor(private readonly serviceName = 'auth-service') {}

  async check(): Promise<HealthResponse> {
    return {
      service: this.serviceName,
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
      dependencies: [],
    };
  }

  async ready(): Promise<HealthResponse> {
    return this.check();
  }
}
