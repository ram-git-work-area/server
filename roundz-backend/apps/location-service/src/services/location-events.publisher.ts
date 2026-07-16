import { KafkaProducerClient } from '@roundz/kafka';
import type { KafkaTopic } from '@roundz/kafka';

export type LocationEventName =
  | Extract<KafkaTopic, 'location.updated'>
  | Extract<KafkaTopic, 'location.online'>
  | Extract<KafkaTopic, 'location.offline'>
  | Extract<KafkaTopic, 'location.heartbeat'>
  | Extract<KafkaTopic, 'location.stale'>;

export interface LocationEventPublisher {
  publish<TPayload extends Record<string, unknown>>(
    topic: LocationEventName,
    key: string,
    payload: TPayload,
  ): Promise<void>;
  close?(): Promise<void>;
}

export class NoopLocationEventPublisher implements LocationEventPublisher {
  async publish(): Promise<void> {
    return undefined;
  }
}

export class KafkaLocationEventPublisher implements LocationEventPublisher {
  private readonly producer: KafkaProducerClient;

  constructor(brokers: string[]) {
    this.producer = new KafkaProducerClient({
      clientId: 'location-service',
      brokers,
    });
  }

  async connect() {
    await this.producer.connect();
  }

  async publish<TPayload extends Record<string, unknown>>(
    topic: LocationEventName,
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
