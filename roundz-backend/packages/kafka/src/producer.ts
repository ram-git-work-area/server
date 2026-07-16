import { Kafka, type Producer, type ProducerRecord } from 'kafkajs';

export type KafkaProducerOptions = {
  clientId: string;
  brokers: string[];
};

export class KafkaProducerClient {
  private readonly producer: Producer;

  constructor(options: KafkaProducerOptions) {
    const kafka = new Kafka({
      clientId: options.clientId,
      brokers: options.brokers,
    });
    this.producer = kafka.producer();
  }

  async connect() {
    await this.producer.connect();
  }

  async publish(record: ProducerRecord) {
    await this.producer.send(record);
  }

  async disconnect() {
    await this.producer.disconnect();
  }
}
