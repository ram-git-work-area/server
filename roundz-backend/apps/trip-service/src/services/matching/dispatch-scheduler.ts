/**
 * Schedules the per-batch dispatch timeout. In production this is a process-local
 * timer; because the authoritative deadline is also persisted on the
 * `MatchingSession` (`expiresAt`) and offer reservations carry Redis TTLs, a
 * separate sweeper can recover timeouts if a worker dies — see README.
 */
export interface DispatchScheduler {
  schedule(tripId: string, delayMs: number, task: () => Promise<void>): void;
  cancel(tripId: string): void;
  cancelAll(): void;
}

export class TimeoutDispatchScheduler implements DispatchScheduler {
  private readonly timers = new Map<string, NodeJS.Timeout>();

  constructor(private readonly onError: (error: unknown, tripId: string) => void = () => {}) {}

  schedule(tripId: string, delayMs: number, task: () => Promise<void>): void {
    this.cancel(tripId);
    const timer = setTimeout(() => {
      this.timers.delete(tripId);
      void task().catch((error) => this.onError(error, tripId));
    }, delayMs);
    // Do not keep the event loop alive solely for a pending dispatch timeout.
    timer.unref?.();
    this.timers.set(tripId, timer);
  }

  cancel(tripId: string): void {
    const timer = this.timers.get(tripId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(tripId);
    }
  }

  cancelAll(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
  }
}

/** Test scheduler: records tasks and runs them on demand. */
export class ManualDispatchScheduler implements DispatchScheduler {
  private readonly tasks = new Map<string, () => Promise<void>>();

  schedule(tripId: string, _delayMs: number, task: () => Promise<void>): void {
    this.tasks.set(tripId, task);
  }

  cancel(tripId: string): void {
    this.tasks.delete(tripId);
  }

  cancelAll(): void {
    this.tasks.clear();
  }

  hasPending(tripId: string): boolean {
    return this.tasks.has(tripId);
  }

  async runDue(tripId: string): Promise<void> {
    const task = this.tasks.get(tripId);
    if (task) {
      this.tasks.delete(tripId);
      await task();
    }
  }
}
