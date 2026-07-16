import { KafkaProducerClient } from '@roundz/kafka';
import type { KafkaTopic } from '@roundz/kafka';

export type AuthEventName =
  | Extract<KafkaTopic, 'auth.user_registered'>
  | Extract<KafkaTopic, 'auth.user_logged_in'>
  | Extract<KafkaTopic, 'auth.otp_requested'>
  | Extract<KafkaTopic, 'auth.password_changed'>;

export type AuthEventPublisher = {
  publish<TPayload extends Record<string, unknown>>(
    topic: AuthEventName,
    key: string,
    payload: TPayload,
  ): Promise<void>;
  close?(): Promise<void>;
};

export class NoopAuthEventPublisher implements AuthEventPublisher {
  async publish(): Promise<void> {
    return undefined;
  }
}

export class KafkaAuthEventPublisher implements AuthEventPublisher {
  private readonly producer: KafkaProducerClient;

  constructor(brokers: string[]) {
    this.producer = new KafkaProducerClient({
      clientId: 'auth-service',
      brokers,
    });
  }

  async connect() {
    await this.producer.connect();
  }

  async publish<TPayload extends Record<string, unknown>>(
    topic: AuthEventName,
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
