import { KafkaProducerClient } from '@roundz/kafka';
import type { KafkaTopic } from '@roundz/kafka';

export type RiderEventName =
  | Extract<KafkaTopic, 'rider.created'>
  | Extract<KafkaTopic, 'rider.profile.updated'>
  | Extract<KafkaTopic, 'rider.vehicle.created'>
  | Extract<KafkaTopic, 'rider.vehicle.updated'>
  | Extract<KafkaTopic, 'rider.vehicle.deleted'>
  | Extract<KafkaTopic, 'rider.document.uploaded'>
  | Extract<KafkaTopic, 'rider.document.deleted'>
  | Extract<KafkaTopic, 'rider.status.changed'>
  | Extract<KafkaTopic, 'rider.preferences.updated'>;

export interface RiderEventPublisher {
  publish<TPayload extends Record<string, unknown>>(
    topic: RiderEventName,
    key: string,
    payload: TPayload,
  ): Promise<void>;
  close?(): Promise<void>;
}

export class NoopRiderEventPublisher implements RiderEventPublisher {
  async publish(): Promise<void> {
    return undefined;
  }
}

export class KafkaRiderEventPublisher implements RiderEventPublisher {
  private readonly producer: KafkaProducerClient;

  constructor(brokers: string[]) {
    this.producer = new KafkaProducerClient({
      clientId: 'rider-service',
      brokers,
    });
  }

  async connect() {
    await this.producer.connect();
  }

  async publish<TPayload extends Record<string, unknown>>(
    topic: RiderEventName,
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
