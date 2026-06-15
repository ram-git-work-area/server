export type DependencyStatus = 'up' | 'down' | 'unknown';

export type DependencyHealth = {
  name: string;
  status: DependencyStatus;
  latencyMs?: number;
  details?: Record<string, unknown>;
};

export type HealthResponse = {
  service: string;
  status: 'ok' | 'degraded' | 'unavailable';
  timestamp: string;
  uptimeSeconds: number;
  dependencies: DependencyHealth[];
};
