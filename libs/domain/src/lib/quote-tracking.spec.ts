import {
  isQuoteRejectable,
  isQuoteRenewable,
  isQuoteSendable,
  isValidEmail,
  normalizeWhatsappNumber,
  quoteShareText,
  quoteTimeline,
} from './quote-tracking';
import { effectiveQuoteStatus } from './sales-documents';
import { quoteMachine } from './state-machine';

const base = { createdDay: '2026-10-14', sentDay: '2026-10-14', validUntil: '2026-10-21', closedDay: null };

describe('quote tracking', () => {
  it('a sent quote waits for the answer, an expired one is a warning', () => {
    const waiting = quoteTimeline({ ...base, status: 'SENT' });
    expect(waiting.map((s) => [s.key, s.state])).toEqual([['DRAFT', 'done'], ['SENT', 'done'], ['WAITING', 'current'], ['CONVERTED', 'pending']]);
    const expired = quoteTimeline({ ...base, status: 'EXPIRED' });
    expect(expired[2]).toEqual({ key: 'EXPIRED', state: 'warning', date: '2026-10-21' });
  });

  it('a draft has only its first step', () => {
    const steps = quoteTimeline({ ...base, sentDay: null, status: 'DRAFT' });
    expect(steps.map((s) => s.state)).toEqual(['current', 'pending', 'pending', 'pending']);
  });

  it('rejected and converted quotes show the day they closed', () => {
    expect(quoteTimeline({ ...base, status: 'REJECTED', closedDay: '2026-10-16' })[2]).toEqual({ key: 'REJECTED', state: 'warning', date: '2026-10-16' });
    expect(quoteTimeline({ ...base, status: 'ACCEPTED', closedDay: '2026-10-17' })[3]).toEqual({ key: 'CONVERTED', state: 'done', date: '2026-10-17' });
  });

  it('a quote expires the day after its validity, not on it', () => {
    expect(effectiveQuoteStatus('SENT', '2026-10-21', '2026-10-21')).toBe('SENT');
    expect(effectiveQuoteStatus('SENT', '2026-10-21', '2026-10-22')).toBe('EXPIRED');
  });

  it('only the right statuses can be sent, renewed or rejected', () => {
    expect(['DRAFT', 'SENT', 'EXPIRED', 'REJECTED', 'ACCEPTED'].map((s) => isQuoteSendable(s as never))).toEqual([true, true, false, false, false]);
    expect(isQuoteRenewable('EXPIRED')).toBe(true);
    expect(isQuoteRenewable('SENT')).toBe(false);
    expect(isQuoteRejectable('EXPIRED')).toBe(true);
    expect(isQuoteRejectable('DRAFT')).toBe(false);
  });

  it('an expired quote can be rejected or renewed through the machine', () => {
    expect(quoteMachine.next('EXPIRED', 'reject')).toBe('REJECTED');
    expect(quoteMachine.next('EXPIRED', 'renew')).toBe('SENT');
  });

  it('normalises WhatsApp numbers', () => {
    expect(normalizeWhatsappNumber('7 000 0000')).toBe('59170000000');
    expect(normalizeWhatsappNumber('+591 7 000 0000')).toBe('59170000000');
    expect(normalizeWhatsappNumber('123')).toBeNull();
    expect(isValidEmail('a@b.co')).toBe(true);
    expect(isValidEmail('nope')).toBe(false);
  });

  it('the message has the lines and the total and never a NIT', () => {
    const text = quoteShareText({
      number: 'COT-000046',
      company: 'RODALASER S.R.L.',
      customerName: 'Minera Demo',
      validUntil: '2026-10-21',
      lines: [{ quantity: 12, code: '6205-2RS', name: 'Rodamiento', lineTotal: '2940.00' }],
      total: '2940.00',
    });
    expect(text).toContain('Válida hasta 21/10/2026');
    expect(text).toContain('• 12 × 6205-2RS Rodamiento = Bs 2.940,00');
    expect(text).toContain('Total: Bs 2.940,00');
    expect(text.startsWith('Hola, te enviamos la cotización COT-000046')).toBe(true);
  });
});
