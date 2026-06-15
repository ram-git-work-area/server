import { KafkaProducerClient, KafkaTopics } from '@roundz/kafka';

export class TripEventsService {
  private readonly producer: KafkaProducerClient;

  constructor(kafkaBrokers: string[]) {
    this.producer = new KafkaProducerClient({
      clientId: 'trip-service',
      brokers: kafkaBrokers,
    });
  }

  async publishTripRequested(input: { tripId: string; userId: string }) {
    await this.producer.publish({
      topic: KafkaTopics.TripRequested,
      messages: [
        {
          key: input.tripId,
          value: JSON.stringify(input),
        },
      ],
    });
  }
}
