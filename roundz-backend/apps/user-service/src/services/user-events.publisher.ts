import { KafkaProducerClient } from '@roundz/kafka';
import type { KafkaTopic } from '@roundz/kafka';

export type UserEventName =
  | Extract<KafkaTopic, 'user.profile.updated'>
  | Extract<KafkaTopic, 'user.address.created'>
  | Extract<KafkaTopic, 'user.address.updated'>
  | Extract<KafkaTopic, 'user.address.deleted'>
  | Extract<KafkaTopic, 'user.favorite.created'>
  | Extract<KafkaTopic, 'user.favorite.deleted'>;

export type UserEventPublisher = {
  publish<TPayload extends Record<string, unknown>>(
    topic: UserEventName,
    key: string,
    payload: TPayload,
  ): Promise<void>;
  close?(): Promise<void>;
};

export class NoopUserEventPublisher implements UserEventPublisher {
  async publish(): Promise<void> {
    return undefined;
  }
}

export class KafkaUserEventPublisher implements UserEventPublisher {
  private readonly producer: KafkaProducerClient;

  constructor(brokers: string[]) {
    this.producer = new KafkaProducerClient({
      clientId: 'user-service',
      brokers,
    });
  }

  async connect() {
    await this.producer.connect();
  }

  async publish<TPayload extends Record<string, unknown>>(
    topic: UserEventName,
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
