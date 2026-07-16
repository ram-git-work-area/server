import type { HistoryInput, LocationRepositoryPort } from '../repositories/location.repository';

export interface HistoryWriter {
  add(entry: HistoryInput): Promise<void>;
  flush(): Promise<void>;
  start(): void;
  stop(): Promise<void>;
}

export type BatchingHistoryWriterOptions = {
  batchSize: number;
  flushIntervalMs: number;
  onError?: (error: unknown, droppedCount: number) => void;
};

/**
 * Buffers rider location history writes and persists them with `insertMany` to
 * keep the high-frequency update path cheap. Flushes when the batch fills or on
 * a timer, and drains the buffer on shutdown.
 */
export class BatchingHistoryWriter implements HistoryWriter {
  private buffer: HistoryInput[] = [];
  private timer: NodeJS.Timeout | undefined;
  private flushing = false;

  constructor(
    private readonly repository: LocationRepositoryPort,
    private readonly options: BatchingHistoryWriterOptions,
  ) {}

  async add(entry: HistoryInput) {
    this.buffer.push(entry);

    if (this.buffer.length >= this.options.batchSize) {
      await this.flush();
    }
  }

  start() {
    if (this.timer) {
      return;
    }

    this.timer = setInterval(() => {
      void this.flush();
    }, this.options.flushIntervalMs);
    this.timer.unref?.();
  }

  async flush() {
    if (this.flushing || this.buffer.length === 0) {
      return;
    }

    this.flushing = true;
    const batch = this.buffer;
    this.buffer = [];

    try {
      await this.repository.appendHistoryMany(batch);
    } catch (error) {
      this.options.onError?.(error, batch.length);
    } finally {
      this.flushing = false;
    }
  }

  async stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }

    await this.flush();
  }
}
