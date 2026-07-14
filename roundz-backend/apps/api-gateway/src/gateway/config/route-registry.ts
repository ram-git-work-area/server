import type { RoundzConfig } from '@roundz/config';

export type GatewayServiceKey =
  | 'auth'
  | 'users'
  | 'riders'
  | 'trips'
  | 'location'
  | 'wallet'
  | 'notifications'
  | 'admin';

export type GatewayRoute = {
  key: GatewayServiceKey;
  serviceName: string;
  gatewayPrefix: string;
  downstreamPrefix: string;
  baseUrl?: string;
  publicRoutes?: Array<{
    method: string;
    path: RegExp;
  }>;
};

const publicAuthRoutes = [
  'register',
  'login',
  'refresh',
  'otp/request',
  'otp/verify',
  'forgot-password',
  'verify-email',
];

export class RouteRegistry {
  private readonly routes: GatewayRoute[];

  constructor(config: RoundzConfig) {
    this.routes = [
      {
        key: 'auth',
        serviceName: 'auth-service',
        gatewayPrefix: '/api/auth',
        downstreamPrefix: '/auth',
        baseUrl: config.serviceUrls.auth,
        publicRoutes: publicAuthRoutes.map((route) => ({
          method: 'POST',
          path: new RegExp(`^/api/auth/${route}$`),
        })),
      },
      {
        key: 'users',
        serviceName: 'user-service',
        gatewayPrefix: '/api/users',
        downstreamPrefix: '/users',
        baseUrl: config.serviceUrls.users,
      },
      {
        key: 'riders',
        serviceName: 'rider-service',
        gatewayPrefix: '/api/riders',
        downstreamPrefix: '/riders',
        baseUrl: config.serviceUrls.riders,
      },
      {
        key: 'trips',
        serviceName: 'trip-service',
        gatewayPrefix: '/api/trips',
        downstreamPrefix: '/trips',
        baseUrl: config.serviceUrls.trips,
      },
      {
        key: 'location',
        serviceName: 'location-service',
        gatewayPrefix: '/api/location',
        downstreamPrefix: '/location',
        baseUrl: config.serviceUrls.location,
      },
      {
        key: 'wallet',
        serviceName: 'wallet-service',
        gatewayPrefix: '/api/wallet',
        downstreamPrefix: '/wallet',
        baseUrl: config.serviceUrls.wallet,
      },
      {
        key: 'notifications',
        serviceName: 'notification-service',
        gatewayPrefix: '/api/notifications',
        downstreamPrefix: '/notifications',
        baseUrl: config.serviceUrls.notifications,
      },
      {
        key: 'admin',
        serviceName: 'admin-service',
        gatewayPrefix: '/api/admin',
        downstreamPrefix: '/admin',
        baseUrl: config.serviceUrls.admin,
      },
    ];
  }

  list() {
    return this.routes;
  }

  resolve(pathname: string) {
    return this.routes.find(
      (route) => pathname === route.gatewayPrefix || pathname.startsWith(`${route.gatewayPrefix}/`),
    );
  }

  isPublic(method: string, pathname: string) {
    const route = this.resolve(pathname);

    return Boolean(
      route?.publicRoutes?.some(
        (publicRoute) => publicRoute.method === method && publicRoute.path.test(pathname),
      ),
    );
  }

  rewritePath(route: GatewayRoute, originalUrl: string) {
    const url = new URL(originalUrl, 'http://gateway.local');
    const suffix = url.pathname.slice(route.gatewayPrefix.length);
    const downstreamPath = `${route.downstreamPrefix}${suffix || ''}`;

    return `${downstreamPath}${url.search}`;
  }
}
