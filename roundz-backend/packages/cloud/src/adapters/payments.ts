import type { PaymentProvider } from '../interfaces';

export class RazorpayPaymentAdapter implements PaymentProvider {
  async createPayment(input: { amountMinor: number; currency: string; referenceId: string }) {
    return {
      providerPaymentId: `razorpay-placeholder-${input.referenceId}`,
      status: 'created',
    };
  }

  async refund(input: { providerPaymentId: string; amountMinor?: number; reason?: string }) {
    return {
      providerRefundId: `razorpay-refund-placeholder-${input.providerPaymentId}`,
      status: 'created',
    };
  }
}
