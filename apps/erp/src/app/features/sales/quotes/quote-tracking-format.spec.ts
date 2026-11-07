import type { QuoteDetail } from '@rodasoft/domain';
import { isOutOfStock, quoteDocument, quoteShareDocument, quoteUnits, toTimelineSteps, whatsappUrl } from './quote-tracking-format';

const quote = {
  number: 'COT-000046',
  company: 'RODALASER S.R.L.',
  customer: { id: 'c1', name: 'Minera Demo', documentNumber: '1023456027' },
  createdAt: '2026-10-14T15:00:00.000Z',
  validUntil: '2026-10-21',
  subtotal: '3000.00',
  discountAmount: '150.00',
  roundingAmount: '0.00',
  total: '2850.00',
  lines: [
    { id: 'l1', productId: 'p1', sku: 'S1', code: '6205-2RS', name: 'Rodamiento', quantity: 12, unitPrice: '245.00', lineTotal: '2940.00', available: 24 },
    { id: 'l2', productId: 'p2', sku: 'S2', code: '30208', name: 'Cónico', quantity: 4, unitPrice: '525.00', lineTotal: '2100.00', available: 0 },
  ],
} as unknown as QuoteDetail;

describe('quote tracking format', () => {
  it('labels the timeline in Spanish with short dates and a dash for what has not happened', () => {
    const steps = toTimelineSteps([
      { key: 'DRAFT', state: 'done', date: '2026-10-14' },
      { key: 'SENT', state: 'done', date: '2026-10-14' },
      { key: 'EXPIRED', state: 'warning', date: '2026-10-21' },
      { key: 'CONVERTED', state: 'pending', date: null },
    ]);
    expect(steps).toEqual([
      { label: 'Borrador', caption: '14/10', state: 'done', stateLabel: 'Completado' },
      { label: 'Enviada', caption: '14/10', state: 'done', stateLabel: 'Completado' },
      { label: 'Vencida', caption: '21/10', state: 'warning', stateLabel: 'Detenida' },
      { label: 'Convertida', caption: '—', state: 'pending', stateLabel: 'Pendiente' },
    ]);
  });

  it('a waiting quote says until when it is valid', () => {
    const [step] = toTimelineSteps([{ key: 'WAITING', state: 'current', date: '2026-10-21' }]);
    expect(step).toEqual({ label: 'Esperando respuesta', caption: 'válida hasta 21/10/2026', state: 'current', stateLabel: 'Paso actual' });
  });

  it('draws the quote as a document with the discount row only when there is one', () => {
    const doc = quoteDocument(quote);
    expect(doc.metaRows.map((r) => r.label)).toEqual(['Cotización', 'Fecha', 'Válida hasta', 'Cliente']);
    expect(doc.items[0]).toMatchObject({ description: '6205-2RS · Rodamiento', detail: '12 × Bs 245,00' });
    expect(doc.totalRows.map((r) => r.label)).toEqual(['Subtotal', 'Descuento', 'Total']);
    expect(doc.totalRows.at(-1)).toMatchObject({ label: 'Total', strong: true });
  });

  it('never puts the customer’s NIT in what is shared', () => {
    expect(JSON.stringify(quoteShareDocument(quote))).not.toContain('1023456027');
  });

  it('builds the WhatsApp link with the text encoded', () => {
    expect(whatsappUrl('59170000000', 'Hola, Ana & Luis')).toBe('https://wa.me/59170000000?text=Hola%2C%20Ana%20%26%20Luis');
  });

  it('knows a line is short of stock, and that no warehouse means nothing to say', () => {
    expect(isOutOfStock(0, 4)).toBe(true);
    expect(isOutOfStock(3, 4)).toBe(true);
    expect(isOutOfStock(4, 4)).toBe(false);
    expect(isOutOfStock(null, 4)).toBe(false);
    expect(quoteUnits(quote)).toBe(16);
  });
});
