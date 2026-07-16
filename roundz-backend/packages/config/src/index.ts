import dotenv from 'dotenv';
import { z } from 'zod';

const booleanFromEnv = z.preprocess((value) => {
  if (typeof value === 'string') {
    return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
  }

  return value;
}, z.boolean());

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z
    .string()
    .min(1)
    .default('postgresql://roundz:roundz@localhost:5432/roundz?schema=public'),
  MONGO_URL: z.string().min(1).default('mongodb://roundz:roundz@localhost:27017/roundz'),
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),
  KAFKA_BROKERS: z
    .string()
    .min(1)
    .default('localhost:9092')
    .transform((value) =>
      value
        .split(',')
        .map((broker) => broker.trim())
        .filter(Boolean),
    ),
  JWT_SECRET: z.string().min(16).default('local-development-jwt-secret-change-me'),
  JWT_ACCESS_TOKEN_EXPIRES_IN: z.string().min(1).default('15m'),
  JWT_REFRESH_TOKEN_EXPIRES_IN: z.string().min(1).default('30d'),
  JWT_ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  JWT_REFRESH_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(2592000),
  AUTH_LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(5),
  AUTH_LOGIN_RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().positive().default(900),
  AUTH_OTP_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(3),
  AUTH_OTP_RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().positive().default(3600),
  AUTH_OTP_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  USER_PROFILE_IMAGE_BUCKET: z.string().min(1).default('roundz-user-profile-images'),
  USER_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  RIDER_DOCUMENT_BUCKET: z.string().min(1).default('roundz-rider-documents'),
  RIDER_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  AUTH_SERVICE_URL: z.string().url().optional(),
  USER_SERVICE_URL: z.string().url().optional(),
  RIDER_SERVICE_URL: z.string().url().optional(),
  TRIP_SERVICE_URL: z.string().url().optional(),
  LOCATION_SERVICE_URL: z.string().url().optional(),
  WALLET_SERVICE_URL: z.string().url().optional(),
  NOTIFICATION_SERVICE_URL: z.string().url().optional(),
  ADMIN_SERVICE_URL: z.string().url().optional(),
  GATEWAY_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(15000),
  GATEWAY_BODY_LIMIT_BYTES: z.coerce.number().int().positive().default(10485760),
  GATEWAY_HEALTH_TIMEOUT_MS: z.coerce.number().int().positive().default(3000),
  GATEWAY_GET_RETRY_ATTEMPTS: z.coerce.number().int().nonnegative().default(2),
  GATEWAY_CIRCUIT_FAILURE_THRESHOLD: z.coerce.number().int().positive().default(5),
  GATEWAY_CIRCUIT_OPEN_MS: z.coerce.number().int().positive().default(30000),
  GATEWAY_RATE_LIMIT_IP_MAX: z.coerce.number().int().positive().default(1200),
  GATEWAY_RATE_LIMIT_USER_MAX: z.coerce.number().int().positive().default(3000),
  GATEWAY_RATE_LIMIT_ENDPOINT_MAX: z.coerce.number().int().positive().default(600),
  GATEWAY_RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().positive().default(60),
  CLOUD_PROVIDER: z.enum(['aws', 'gcp', 'azure', 'local']).default('aws'),
  STORAGE_PROVIDER: z.enum(['s3', 'gcs', 'azure-blob', 'local']).default('s3'),
  PAYMENT_PROVIDER: z.enum(['razorpay', 'stripe', 'mock']).default('razorpay'),
  PUSH_PROVIDER: z.enum(['fcm', 'mock']).default('fcm'),
  ENABLE_EXTERNAL_CONNECTIONS: booleanFromEnv.default(false),
});

export type CloudProvider = z.infer<typeof envSchema>['CLOUD_PROVIDER'];
export type StorageProvider = z.infer<typeof envSchema>['STORAGE_PROVIDER'];
export type PaymentProvider = z.infer<typeof envSchema>['PAYMENT_PROVIDER'];
export type PushProvider = z.infer<typeof envSchema>['PUSH_PROVIDER'];

export type RoundzConfig = {
  nodeEnv: string;
  port: number;
  logLevel: string;
  serviceName: string;
  databaseUrl: string;
  mongoUrl: string;
  redisUrl: string;
  kafkaBrokers: string[];
  jwtSecret: string;
  jwtAccessTokenExpiresIn: string;
  jwtRefreshTokenExpiresIn: string;
  jwtAccessTokenTtlSeconds: number;
  jwtRefreshTokenTtlSeconds: number;
  authLoginRateLimitMax: number;
  authLoginRateLimitWindowSeconds: number;
  authOtpRateLimitMax: number;
  authOtpRateLimitWindowSeconds: number;
  authOtpTtlSeconds: number;
  userProfileImageBucket: string;
  userCacheTtlSeconds: number;
  riderDocumentBucket: string;
  riderCacheTtlSeconds: number;
  serviceUrls: {
    auth?: string;
    users?: string;
    riders?: string;
    trips?: string;
    location?: string;
    wallet?: string;
    notifications?: string;
    admin?: string;
  };
  gatewayRequestTimeoutMs: number;
  gatewayBodyLimitBytes: number;
  gatewayHealthTimeoutMs: number;
  gatewayGetRetryAttempts: number;
  gatewayCircuitFailureThreshold: number;
  gatewayCircuitOpenMs: number;
  gatewayRateLimitIpMax: number;
  gatewayRateLimitUserMax: number;
  gatewayRateLimitEndpointMax: number;
  gatewayRateLimitWindowSeconds: number;
  cloudProvider: CloudProvider;
  storageProvider: StorageProvider;
  paymentProvider: PaymentProvider;
  pushProvider: PushProvider;
  enableExternalConnections: boolean;
};

type LoadConfigOptions = {
  serviceName: string;
  defaultPort?: number;
};

export function loadConfig(options: LoadConfigOptions): RoundzConfig {
  dotenv.config();

  const parsed = envSchema.parse({
    ...process.env,
    PORT: process.env.PORT ?? options.defaultPort,
  });

  return {
    nodeEnv: parsed.NODE_ENV,
    port: parsed.PORT,
    logLevel: parsed.LOG_LEVEL,
    serviceName: options.serviceName,
    databaseUrl: parsed.DATABASE_URL,
    mongoUrl: parsed.MONGO_URL,
    redisUrl: parsed.REDIS_URL,
    kafkaBrokers: parsed.KAFKA_BROKERS,
    jwtSecret: parsed.JWT_SECRET,
    jwtAccessTokenExpiresIn: parsed.JWT_ACCESS_TOKEN_EXPIRES_IN,
    jwtRefreshTokenExpiresIn: parsed.JWT_REFRESH_TOKEN_EXPIRES_IN,
    jwtAccessTokenTtlSeconds: parsed.JWT_ACCESS_TOKEN_TTL_SECONDS,
    jwtRefreshTokenTtlSeconds: parsed.JWT_REFRESH_TOKEN_TTL_SECONDS,
    authLoginRateLimitMax: parsed.AUTH_LOGIN_RATE_LIMIT_MAX,
    authLoginRateLimitWindowSeconds: parsed.AUTH_LOGIN_RATE_LIMIT_WINDOW_SECONDS,
    authOtpRateLimitMax: parsed.AUTH_OTP_RATE_LIMIT_MAX,
    authOtpRateLimitWindowSeconds: parsed.AUTH_OTP_RATE_LIMIT_WINDOW_SECONDS,
    authOtpTtlSeconds: parsed.AUTH_OTP_TTL_SECONDS,
    userProfileImageBucket: parsed.USER_PROFILE_IMAGE_BUCKET,
    userCacheTtlSeconds: parsed.USER_CACHE_TTL_SECONDS,
    riderDocumentBucket: parsed.RIDER_DOCUMENT_BUCKET,
    riderCacheTtlSeconds: parsed.RIDER_CACHE_TTL_SECONDS,
    serviceUrls: {
      auth: parsed.AUTH_SERVICE_URL,
      users: parsed.USER_SERVICE_URL,
      riders: parsed.RIDER_SERVICE_URL,
      trips: parsed.TRIP_SERVICE_URL,
      location: parsed.LOCATION_SERVICE_URL,
      wallet: parsed.WALLET_SERVICE_URL,
      notifications: parsed.NOTIFICATION_SERVICE_URL,
      admin: parsed.ADMIN_SERVICE_URL,
    },
    gatewayRequestTimeoutMs: parsed.GATEWAY_REQUEST_TIMEOUT_MS,
    gatewayBodyLimitBytes: parsed.GATEWAY_BODY_LIMIT_BYTES,
    gatewayHealthTimeoutMs: parsed.GATEWAY_HEALTH_TIMEOUT_MS,
    gatewayGetRetryAttempts: parsed.GATEWAY_GET_RETRY_ATTEMPTS,
    gatewayCircuitFailureThreshold: parsed.GATEWAY_CIRCUIT_FAILURE_THRESHOLD,
    gatewayCircuitOpenMs: parsed.GATEWAY_CIRCUIT_OPEN_MS,
    gatewayRateLimitIpMax: parsed.GATEWAY_RATE_LIMIT_IP_MAX,
    gatewayRateLimitUserMax: parsed.GATEWAY_RATE_LIMIT_USER_MAX,
    gatewayRateLimitEndpointMax: parsed.GATEWAY_RATE_LIMIT_ENDPOINT_MAX,
    gatewayRateLimitWindowSeconds: parsed.GATEWAY_RATE_LIMIT_WINDOW_SECONDS,
    cloudProvider: parsed.CLOUD_PROVIDER,
    storageProvider: parsed.STORAGE_PROVIDER,
    paymentProvider: parsed.PAYMENT_PROVIDER,
    pushProvider: parsed.PUSH_PROVIDER,
    enableExternalConnections: parsed.ENABLE_EXTERNAL_CONNECTIONS,
  };
}
