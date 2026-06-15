import type { PushNotificationProvider } from '../interfaces';

export class FirebaseFcmPushAdapter implements PushNotificationProvider {
  async send(input: { token: string; title: string; body: string; data?: Record<string, string> }) {
    void input;
  }
}
