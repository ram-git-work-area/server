import { Kafka, type Consumer, type EachMessagePayload } from 'kafkajs';

export type KafkaConsumerOptions = {
  clientId: string;
  groupId: string;
  brokers: string[];
};

export type MessageHandler = (payload: EachMessagePayload) => Promise<void>;

export class KafkaConsumerClient {
  private readonly consumer: Consumer;

  constructor(options: KafkaConsumerOptions) {
    const kafka = new Kafka({
      clientId: options.clientId,
      brokers: options.brokers,
    });
    this.consumer = kafka.consumer({ groupId: options.groupId });
  }

  async connect() {
    await this.consumer.connect();
  }

  async subscribe(topic: string, handler: MessageHandler, fromBeginning = false) {
    await this.consumer.subscribe({ topic, fromBeginning });
    await this.consumer.run({ eachMessage: handler });
  }

  async disconnect() {
    await this.consumer.disconnect();
  }
}
