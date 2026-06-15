export type ObjectMetadata = Record<string, string>;

export type PutObjectInput = {
  bucket: string;
  key: string;
  body: Buffer | Uint8Array | string;
  contentType?: string;
  metadata?: ObjectMetadata;
};

export type ObjectStorageProvider = {
  putObject(input: PutObjectInput): Promise<{ uri: string }>;
  getSignedReadUrl(bucket: string, key: string, expiresInSeconds: number): Promise<string>;
  deleteObject(bucket: string, key: string): Promise<void>;
};

export type EventProvider = {
  publish<TPayload>(topic: string, payload: TPayload, key?: string): Promise<void>;
  subscribe<TPayload>(topic: string, handler: (payload: TPayload) => Promise<void>): Promise<void>;
};

export type SecretsProvider = {
  getSecret(name: string): Promise<string>;
};

export type PushNotificationProvider = {
  send(input: {
    token: string;
    title: string;
    body: string;
    data?: Record<string, string>;
  }): Promise<void>;
};

export type PaymentProvider = {
  createPayment(input: {
    amountMinor: number;
    currency: string;
    referenceId: string;
  }): Promise<{ providerPaymentId: string; status: string }>;
  refund(input: {
    providerPaymentId: string;
    amountMinor?: number;
    reason?: string;
  }): Promise<{ providerRefundId: string; status: string }>;
};

export type MapsProvider = {
  geocode(address: string): Promise<{ lat: number; lng: number }>;
  estimateRoute(input: {
    origin: { lat: number; lng: number };
    destination: { lat: number; lng: number };
  }): Promise<{ distanceMeters: number; durationSeconds: number }>;
};
