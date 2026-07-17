import type { EachMessagePayload } from 'kafkajs';
import { KafkaTopics } from '@roundz/kafka';
import type { KafkaConsumerClient } from '@roundz/kafka';
import { z } from 'zod';
import type { MatchingEngine, MatchingLogger } from '../services/matching/matching-engine.service';
import { noopMatchingLogger } from '../services/matching/matching-engine.service';

export const MATCHING_CONSUMER_TOPICS: string[] = [
  KafkaTopics.TripCreated,
  KafkaTopics.TripCancelled,
  KafkaTopics.RiderStatusChanged,
  KafkaTopics.LocationUpdated,
];

const contextSchema = z
  .object({
    requestId: z.string().optional(),
    traceId: z.string().optional(),
  })
  .partial();

const tripCreatedSchema = contextSchema.extend({
  tripId: z.string().min(1),
});

const tripCancelledSchema = contextSchema.extend({
  tripId: z.string().min(1),
});

const riderStatusChangedSchema = z.object({
  riderId: z.string().min(1),
  status: z.string().default('INACTIVE'),
  approvalStatus: z.string().default('PENDING'),
  onlineStatus: z.string().default('OFFLINE'),
  isBusy: z.boolean().default(false),
  hasActiveTrip: z.boolean().default(false),
  primaryVehicleType: z
    .enum(['BIKE', 'AUTO', 'CAR', 'SUV', 'VAN', 'TRUCK'])
    .nullish()
    .transform((value) => value ?? null),
  hasCurrentLocation: z.boolean().default(false),
  rating: z.number().min(0).max(5).default(0),
  activeTripCount: z.number().int().nonnegative().default(0),
});

const locationUpdatedSchema = z.object({
  riderId: z.string().min(1),
});

/**
 * Dispatches inbound Kafka events to the matching engine. Handlers are pure and
 * exported so they can be unit tested without a broker; the Kafka wiring below
 * simply parses the message and forwards it.
 */
export class MatchingConsumer {
  private readonly logger: MatchingLogger;

  constructor(
    private readonly engine: MatchingEngine,
    logger: MatchingLogger = noopMatchingLogger,
  ) {
    this.logger = logger;
  }

  async handle(topic: string, rawValue: string | null): Promise<void> {
    if (!rawValue) {
      return;
    }

    let payload: unknown;
    try {
      payload = JSON.parse(rawValue);
    } catch (error) {
      this.logger.error({ err: error, topic }, 'failed to parse matching event payload');
      return;
    }

    switch (topic) {
      case KafkaTopics.TripCreated: {
        const event = tripCreatedSchema.parse(payload);
        await this.engine.startMatching(event.tripId, {
          requestId: event.requestId,
          traceId: event.traceId,
        });
        return;
      }
      case KafkaTopics.TripCancelled: {
        const event = tripCancelledSchema.parse(payload);
        await this.engine.cancelMatching(event.tripId, {
          requestId: event.requestId,
          traceId: event.traceId,
        });
        return;
      }
      case KafkaTopics.RiderStatusChanged: {
        const event = riderStatusChangedSchema.parse(payload);
        await this.engine.ingestRiderStatus(event);
        return;
      }
      case KafkaTopics.LocationUpdated: {
        const event = locationUpdatedSchema.parse(payload);
        await this.engine.ingestRiderLocation(event.riderId);
        return;
      }
      default:
        this.logger.warn({ topic }, 'received event for unhandled matching topic');
    }
  }
}

/**
 * Subscribes the matching consumer to all inbound topics on a single run loop.
 * Errors in a handler are logged and swallowed so one poison message cannot stall
 * the partition; production would route these to a dead-letter topic.
 */
export async function startMatchingConsumers(
  consumer: KafkaConsumerClient,
  matchingConsumer: MatchingConsumer,
  logger: MatchingLogger = noopMatchingLogger,
): Promise<void> {
  await consumer.connect();
  await consumer.subscribeMany(MATCHING_CONSUMER_TOPICS, async (payload: EachMessagePayload) => {
    const value = payload.message.value?.toString() ?? null;
    try {
      await matchingConsumer.handle(payload.topic, value);
    } catch (error) {
      logger.error(
        { err: error, topic: payload.topic, partition: payload.partition },
        'matching consumer handler failed',
      );
    }
  });
}
