import { KafkaProducerClient } from '@roundz/kafka';
import type { KafkaTopic } from '@roundz/kafka';

export type TripEventName =
  | Extract<KafkaTopic, 'trip.created'>
  | Extract<KafkaTopic, 'trip.search.started'>
  | Extract<KafkaTopic, 'trip.status.changed'>
  | Extract<KafkaTopic, 'trip.cancelled'>;

export interface TripEventPublisher {
  publish<TPayload extends Record<string, unknown>>(
    topic: TripEventName,
    key: string,
    payload: TPayload,
  ): Promise<void>;
  close?(): Promise<void>;
}

export class NoopTripEventPublisher implements TripEventPublisher {
  async publish(): Promise<void> {
    return undefined;
  }
}

export class KafkaTripEventPublisher implements TripEventPublisher {
  private readonly producer: KafkaProducerClient;

  constructor(brokers: string[]) {
    this.producer = new KafkaProducerClient({
      clientId: 'trip-service',
      brokers,
    });
  }

  async connect() {
    await this.producer.connect();
  }

  async publish<TPayload extends Record<string, unknown>>(
    topic: TripEventName,
    key: string,
    payload: TPayload,
  ) {
    await this.producer.publish({
      topic,
      messages: [
        {
          key,
          value: JSON.stringify(payload),
        },
      ],
    });
  }

  async close() {
    await this.producer.disconnect();
  }
}
