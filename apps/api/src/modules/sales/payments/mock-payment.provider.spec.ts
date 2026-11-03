import { Decimal } from '@rodasoft/domain';
import { MockPaymentProvider } from './mock-payment.provider';
import { PaymentProviderError } from './payment-provider';

const request = (idempotencyKey: string, amount = '120.50', companyId = 'c1') => ({
  amount: Decimal.of(amount),
  method: 'QR' as const,
  idempotencyKey,
  companyId,
});

describe('MockPaymentProvider', () => {
  let provider: MockPaymentProvider;
  beforeEach(() => (provider = new MockPaymentProvider()));

  it('charges as pending and derives the reference from the idempotency key', async () => {
    const r = await provider.charge(request('k-1'));
    expect(r).toEqual({ providerRef: 'mock-c1-qr-k-1', status: 'PENDING' });
  });

  it('a retry of a settled charge reports the state it reached, not PENDING', async () => {
    const confirmed = await provider.charge(request('k-1'));
    await provider.confirm(confirmed.providerRef, 'APPROVED');
    expect((await provider.charge(request('k-1'))).status).toBe('CONFIRMED');

    const declined = await provider.charge(request('k-2'));
    await provider.confirm(declined.providerRef, 'DECLINED');
    expect((await provider.charge(request('k-2'))).status).toBe('DECLINED');

    const cancelled = await provider.charge(request('k-3'));
    await provider.cancel(cancelled.providerRef);
    expect((await provider.charge(request('k-3'))).status).toBe('CANCELLED');
  });

  it('keeps companies apart: the same key in two companies is two payments', async () => {
    const a = await provider.charge(request('k-1', '10.00', 'c1'));
    const b = await provider.charge(request('k-1', '99.00', 'c2'));
    expect(b.providerRef).not.toBe(a.providerRef);
  });

  it('the same idempotency key gives the same reference and does not charge twice', async () => {
    const first = await provider.charge(request('k-1'));
    const second = await provider.charge(request('k-1'));
    expect(second.providerRef).toBe(first.providerRef);
    // still one payment: confirming once settles it
    await provider.confirm(first.providerRef, 'APPROVED');
    await expect(provider.cancel(first.providerRef)).rejects.toMatchObject({ code: 'PAYMENT_INVALID_STATE' });
  });

  it('refuses an idempotency key reused for another amount', async () => {
    await provider.charge(request('k-1', '10.00'));
    await expect(provider.charge(request('k-1', '99.00'))).rejects.toMatchObject({ code: 'PAYMENT_IDEMPOTENCY_CONFLICT' });
  });

  it('keeps QR and card charges with the same key apart', async () => {
    const qr = await provider.charge(request('k-1'));
    const card = await provider.charge({ ...request('k-1'), method: 'CARD' });
    expect(card.providerRef).not.toBe(qr.providerRef);
  });

  it('confirms an approved payment, and confirming it again is a no-op', async () => {
    const { providerRef } = await provider.charge(request('k-1'));
    expect(await provider.confirm(providerRef, 'APPROVED')).toEqual({ providerRef, status: 'CONFIRMED' });
    expect(await provider.confirm(providerRef, 'APPROVED')).toEqual({ providerRef, status: 'CONFIRMED' });
  });

  it('records a declined payment, and declining again is a no-op', async () => {
    const { providerRef } = await provider.charge(request('k-1'));
    expect(await provider.confirm(providerRef, 'DECLINED')).toEqual({ providerRef, status: 'DECLINED' });
    expect(await provider.confirm(providerRef, 'DECLINED')).toEqual({ providerRef, status: 'DECLINED' });
  });

  it('refuses a different outcome once the payment is decided', async () => {
    const { providerRef } = await provider.charge(request('k-1'));
    await provider.confirm(providerRef, 'APPROVED');
    await expect(provider.confirm(providerRef, 'DECLINED')).rejects.toMatchObject({ code: 'PAYMENT_INVALID_STATE' });
  });

  it('cancels a pending payment, and cancelling it again is a no-op', async () => {
    const { providerRef } = await provider.charge(request('k-1'));
    expect(await provider.cancel(providerRef)).toEqual({ providerRef, status: 'CANCELLED' });
    expect(await provider.cancel(providerRef)).toEqual({ providerRef, status: 'CANCELLED' });
  });

  it('refuses to cancel once the payment is confirmed or declined', async () => {
    const confirmed = await provider.charge(request('k-1'));
    await provider.confirm(confirmed.providerRef, 'APPROVED');
    await expect(provider.cancel(confirmed.providerRef)).rejects.toBeInstanceOf(PaymentProviderError);

    const declined = await provider.charge(request('k-2'));
    await provider.confirm(declined.providerRef, 'DECLINED');
    await expect(provider.cancel(declined.providerRef)).rejects.toMatchObject({ code: 'PAYMENT_INVALID_STATE' });
  });

  it('refuses to confirm a cancelled payment', async () => {
    const { providerRef } = await provider.charge(request('k-1'));
    await provider.cancel(providerRef);
    await expect(provider.confirm(providerRef, 'APPROVED')).rejects.toMatchObject({ code: 'PAYMENT_INVALID_STATE' });
  });

  it('refuses an unknown reference', async () => {
    await expect(provider.confirm('nope', 'APPROVED')).rejects.toMatchObject({ code: 'PAYMENT_NOT_FOUND' });
    await expect(provider.cancel('nope')).rejects.toMatchObject({ code: 'PAYMENT_NOT_FOUND' });
  });
});
