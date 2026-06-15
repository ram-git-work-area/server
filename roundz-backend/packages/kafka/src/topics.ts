export const KafkaTopics = {
  TripRequested: 'trip.requested',
  TripAccepted: 'trip.accepted',
  TripCancelled: 'trip.cancelled',
  TripStarted: 'trip.started',
  TripCompleted: 'trip.completed',
  RiderLocationUpdated: 'rider.location.updated',
  WalletTransactionCreated: 'wallet.transaction.created',
  NotificationSendRequested: 'notification.send.requested',
} as const;

export type KafkaTopic = (typeof KafkaTopics)[keyof typeof KafkaTopics];
