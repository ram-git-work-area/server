import { KafkaProducerClient } from '@roundz/kafka';
import type { KafkaTopic } from '@roundz/kafka';

/** Topics owned/emitted by the matching subsystem (plus trip status changes). */
export type MatchingEventName =
  | Extract<KafkaTopic, 'trip.search.started'>
  | Extract<KafkaTopic, 'trip.search.expanded'>
  | Extract<KafkaTopic, 'trip.search.failed'>
  | Extract<KafkaTopic, 'trip.status.changed'>
  | Extract<KafkaTopic, 'trip.rider.notified'>
  | Extract<KafkaTopic, 'trip.rider.accepted'>
  | Extract<KafkaTopic, 'trip.rider.rejected'>
  | Extract<KafkaTopic, 'trip.rider.assigned'>;

export interface MatchingEventPublisher {
  publish<TPayload extends Record<string, unknown>>(
    topic: MatchingEventName,
    key: string,
    payload: TPayload,
  ): Promise<void>;
  close?(): Promise<void>;
}

export class NoopMatchingEventPublisher implements MatchingEventPublisher {
  async publish(): Promise<void> {
    return undefined;
  }
}

export class KafkaMatchingEventPublisher implements MatchingEventPublisher {
  private readonly producer: KafkaProducerClient;

  constructor(brokers: string[]) {
    this.producer = new KafkaProducerClient({ clientId: 'trip-service-matching', brokers });
  }

  async connect() {
    await this.producer.connect();
  }

  async publish<TPayload extends Record<string, unknown>>(
    topic: MatchingEventName,
    key: string,
    payload: TPayload,
  ) {
    await this.producer.publish({
      topic,
      messages: [{ key, value: JSON.stringify(payload) }],
    });
  }

  async close() {
    await this.producer.disconnect();
  }
}
