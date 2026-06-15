type ServiceRoute = {
  service: string;
  baseUrlEnv: string;
};

const serviceRoutes: Record<string, ServiceRoute> = {
  auth: { service: 'auth-service', baseUrlEnv: 'AUTH_SERVICE_URL' },
  users: { service: 'user-service', baseUrlEnv: 'USER_SERVICE_URL' },
  riders: { service: 'rider-service', baseUrlEnv: 'RIDER_SERVICE_URL' },
  trips: { service: 'trip-service', baseUrlEnv: 'TRIP_SERVICE_URL' },
  wallet: { service: 'wallet-service', baseUrlEnv: 'WALLET_SERVICE_URL' },
  notifications: { service: 'notification-service', baseUrlEnv: 'NOTIFICATION_SERVICE_URL' },
  locations: { service: 'location-service', baseUrlEnv: 'LOCATION_SERVICE_URL' },
  admin: { service: 'admin-service', baseUrlEnv: 'ADMIN_SERVICE_URL' },
};

export class GatewayService {
  resolveRoute(serviceKey: string, path: string) {
    const target = serviceRoutes[serviceKey];

    return {
      message: 'Route forwarding is intentionally a placeholder in the base architecture.',
      targetService: target?.service ?? 'unknown',
      targetBaseUrlEnv: target?.baseUrlEnv,
      path,
    };
  }
}
