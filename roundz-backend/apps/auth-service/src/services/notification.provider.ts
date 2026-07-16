export type OtpNotificationInput = {
  destination: string;
  code: string;
  purpose: 'LOGIN' | 'REGISTER';
};

export type EmailVerificationInput = {
  email: string;
  token: string;
};

export interface AuthNotificationProvider {
  sendOtp(input: OtpNotificationInput): Promise<void>;
  sendEmailVerification(input: EmailVerificationInput): Promise<void>;
}

export class NoopAuthNotificationProvider implements AuthNotificationProvider {
  async sendOtp(_input: OtpNotificationInput): Promise<void> {
    return undefined;
  }

  async sendEmailVerification(_input: EmailVerificationInput): Promise<void> {
    return undefined;
  }
}
