export const KafkaTopics = {
  TripRequested: 'trip.requested',
  TripAccepted: 'trip.accepted',
  TripCancelled: 'trip.cancelled',
  TripStarted: 'trip.started',
  TripCompleted: 'trip.completed',
  RiderLocationUpdated: 'rider.location.updated',
  WalletTransactionCreated: 'wallet.transaction.created',
  NotificationSendRequested: 'notification.send.requested',
  AuthUserRegistered: 'auth.user_registered',
  AuthUserLoggedIn: 'auth.user_logged_in',
  AuthOtpRequested: 'auth.otp_requested',
  AuthPasswordChanged: 'auth.password_changed',
} as const;

export type KafkaTopic = (typeof KafkaTopics)[keyof typeof KafkaTopics];
