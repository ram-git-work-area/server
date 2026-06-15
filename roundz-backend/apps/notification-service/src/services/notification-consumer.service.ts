import { KafkaConsumerClient, KafkaTopics } from '@roundz/kafka';

export class NotificationConsumerService {
  private readonly consumer: KafkaConsumerClient;

  constructor(kafkaBrokers: string[]) {
    this.consumer = new KafkaConsumerClient({
      clientId: 'notification-service',
      groupId: 'notification-service',
      brokers: kafkaBrokers,
    });
  }

  async start() {
    await this.consumer.connect();
    await this.consumer.subscribe(KafkaTopics.NotificationSendRequested, async ({ message }) => {
      const payload = message.value?.toString();
      void payload;
    });
  }
}
