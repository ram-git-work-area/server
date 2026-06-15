import pino from 'pino';

const redactPaths = [
  'req.headers.authorization',
  'request.headers.authorization',
  'password',
  'token',
  'accessToken',
  'refreshToken',
  'jwtSecret',
];

export function createLogger(serviceName: string, level = 'info') {
  return pino({
    name: serviceName,
    level,
    redact: {
      paths: redactPaths,
      remove: true,
    },
    base: {
      service: serviceName,
    },
  });
}

export function createFastifyLoggerOptions(serviceName: string, level = 'info') {
  return {
    level,
    name: serviceName,
    redact: redactPaths,
  };
}
