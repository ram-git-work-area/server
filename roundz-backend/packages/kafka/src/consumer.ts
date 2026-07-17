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

  /**
   * Subscribes to several topics and starts a single consumer run loop. kafkajs
   * only allows `run` to be called once, so multi-topic consumers must subscribe
   * to every topic before running.
   */
  async subscribeMany(topics: string[], handler: MessageHandler, fromBeginning = false) {
    for (const topic of topics) {
      await this.consumer.subscribe({ topic, fromBeginning });
    }
    await this.consumer.run({ eachMessage: handler });
  }

  async disconnect() {
    await this.consumer.disconnect();
  }
}
