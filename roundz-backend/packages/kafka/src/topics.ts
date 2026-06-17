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
  UserProfileUpdated: 'user.profile.updated',
  UserAddressCreated: 'user.address.created',
  UserAddressUpdated: 'user.address.updated',
  UserAddressDeleted: 'user.address.deleted',
  UserFavoriteCreated: 'user.favorite.created',
  UserFavoriteDeleted: 'user.favorite.deleted',
} as const;

export type KafkaTopic = (typeof KafkaTopics)[keyof typeof KafkaTopics];
