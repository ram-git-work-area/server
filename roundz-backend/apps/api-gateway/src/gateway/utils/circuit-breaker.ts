export type CircuitState = 'closed' | 'open' | 'half-open';

export type CircuitBreakerSnapshot = {
  state: CircuitState;
  failureCount: number;
  openedUntil?: Date;
};

export class CircuitBreaker {
  private state: CircuitState = 'closed';
  private failureCount = 0;
  private openedUntil = 0;

  constructor(
    private readonly failureThreshold: number,
    private readonly openMs: number,
  ) {}

  canRequest() {
    if (this.state !== 'open') {
      return true;
    }

    if (Date.now() >= this.openedUntil) {
      this.state = 'half-open';
      return true;
    }

    return false;
  }

  recordSuccess() {
    this.failureCount = 0;
    this.state = 'closed';
    this.openedUntil = 0;
  }

  recordFailure() {
    this.failureCount += 1;

    if (this.failureCount >= this.failureThreshold || this.state === 'half-open') {
      this.state = 'open';
      this.openedUntil = Date.now() + this.openMs;
    }
  }

  snapshot(): CircuitBreakerSnapshot {
    return {
      state: this.state,
      failureCount: this.failureCount,
      ...(this.openedUntil > 0 ? { openedUntil: new Date(this.openedUntil) } : {}),
    };
  }
}
