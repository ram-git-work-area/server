export type PresenceSweeperTarget = {
  sweepStalePresence: () => Promise<number>;
};

export type PresenceSweeperLogger = {
  error: (obj: Record<string, unknown>, msg: string) => void;
};

/**
 * Periodically triggers stale-presence sweeps. A single instance across the
 * fleet performs the sweep at a time thanks to the Redis lock inside the
 * service; every instance can safely run this loop. Configurable interval.
 */
export class PresenceSweeper {
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly target: PresenceSweeperTarget,
    private readonly intervalSeconds: number,
    private readonly logger?: PresenceSweeperLogger,
  ) {}

  start() {
    if (this.timer) {
      return;
    }

    this.timer = setInterval(() => {
      this.target.sweepStalePresence().catch((error: unknown) => {
        this.logger?.error({ err: error }, 'presence sweep failed');
      });
    }, this.intervalSeconds * 1000);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }
}
