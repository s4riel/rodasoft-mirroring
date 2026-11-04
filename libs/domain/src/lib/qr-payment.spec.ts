import { buildQrPayload, canCompleteWithPayments, isQrExpired, qrExpiresAt, QR_PAYLOAD_PREFIX } from './qr-payment';
import { Decimal } from './money';
import { InvalidTransitionError, paymentMachine } from './state-machine';

describe('buildQrPayload', () => {
  it('encodes the reference and the amount with two decimals', () => {
    expect(buildQrPayload('mock-1', Decimal.of('1111'))).toBe(`${QR_PAYLOAD_PREFIX}|mock-1|1111.00`);
  });

  it('is the same for the same payment', () => {
    expect(buildQrPayload('mock-1', Decimal.of('10.5'))).toBe(buildQrPayload('mock-1', Decimal.of('10.50')));
  });
});

describe('QR deadline', () => {
  const from = new Date('2026-11-05T12:00:00.000Z');

  it('adds the timeout in seconds', () => {
    expect(qrExpiresAt(from, 300).toISOString()).toBe('2026-11-05T12:05:00.000Z');
  });

  it('counts the deadline itself as expired', () => {
    const deadline = qrExpiresAt(from, 300);
    expect(isQrExpired(deadline, new Date('2026-11-05T12:04:59.999Z'))).toBe(false);
    expect(isQrExpired(deadline, new Date('2026-11-05T12:05:00.000Z'))).toBe(true);
    expect(isQrExpired(deadline.toISOString(), new Date('2026-11-05T12:06:00.000Z'))).toBe(true);
  });
});

describe('canCompleteWithPayments', () => {
  it('refuses a sale without payments', () => {
    expect(canCompleteWithPayments([])).toBe(false);
  });

  it('lets cash through whatever its status', () => {
    expect(canCompleteWithPayments([{ method: 'CASH', status: 'PENDING' }])).toBe(true);
  });

  it('needs a QR to be confirmed', () => {
    expect(canCompleteWithPayments([{ method: 'QR', status: 'CONFIRMED' }])).toBe(true);
    for (const status of ['PENDING', 'DECLINED', 'CANCELLED'] as const)
      expect(canCompleteWithPayments([{ method: 'QR', status }])).toBe(false);
  });

  it('needs every provider payment of a mix to be confirmed', () => {
    expect(
      canCompleteWithPayments([
        { method: 'CASH', status: 'CONFIRMED' },
        { method: 'QR', status: 'PENDING' },
      ]),
    ).toBe(false);
  });
});

describe('paymentMachine', () => {
  it('lets a pending payment reach each final state', () => {
    expect(paymentMachine.next('PENDING', 'confirm')).toBe('CONFIRMED');
    expect(paymentMachine.next('PENDING', 'decline')).toBe('DECLINED');
    expect(paymentMachine.next('PENDING', 'cancel')).toBe('CANCELLED');
  });

  it('never leaves a final state, a confirmed payment is not cancelled', () => {
    for (const status of ['CONFIRMED', 'DECLINED', 'CANCELLED'] as const)
      for (const event of ['confirm', 'decline', 'cancel'] as const)
        expect(() => paymentMachine.next(status, event)).toThrow(InvalidTransitionError);
  });
});
