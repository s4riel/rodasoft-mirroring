import type { SaleReturnDetail } from '@rodasoft/domain';
import { creditNoteText, parseReturnStatus, refundText, returnReasonLabel, returnStatusPill, timelineSteps, toReturnRow } from './returns-format';

describe('returns-format', () => {
  it('turns the status into the pill of the Figma', () => {
    expect(returnStatusPill({ status: 'PENDING_APPROVAL', creditNoteStatus: null }).label).toBe('Por aprobar');
    expect(returnStatusPill({ status: 'REJECTED', creditNoteStatus: null }).label).toBe('Rechazada');
    expect(returnStatusPill({ status: 'APPROVED', creditNoteStatus: 'PENDING' }).label).toBe('Aprobada');
    expect(returnStatusPill({ status: 'APPROVED', creditNoteStatus: 'VALID' }).label).toBe('Nota emitida');
  });

  it('parses only known statuses from the URL', () => {
    expect(parseReturnStatus('REJECTED')).toBe('REJECTED');
    expect(parseReturnStatus('x')).toBeNull();
    expect(parseReturnStatus(null)).toBeNull();
  });

  it('labels the reasons and falls back to the code', () => {
    expect(returnReasonLabel('FACTORY_DEFECT')).toBe('Producto con falla de fábrica');
    expect(returnReasonLabel('NEW')).toBe('NEW');
  });

  it('builds the row with the singular piece and the final consumer', () => {
    const row = toReturnRow({
      id: 'r1',
      number: 'DEV-000001',
      saleId: 's',
      saleNumber: 'V-000001',
      customerName: null,
      pieces: 1,
      total: '90.00',
      status: 'APPROVED',
      creditNoteStatus: null,
      createdAt: '2026-11-09T15:00:00.000Z',
    });
    expect(row.cells['customer']).toBe('Consumidor final');
    expect(row.cells['items']).toBe('1 pieza');
  });

  it('says what the credit note and the refund are in each status', () => {
    expect(creditNoteText({ status: 'PENDING_APPROVAL', creditNoteStatus: null })).toBe('Se emite al aprobar');
    expect(creditNoteText({ status: 'APPROVED', creditNoteStatus: 'PENDING' })).toBe('Pendiente');
    expect(creditNoteText({ status: 'REJECTED', creditNoteStatus: null })).toBe('Sin nota');
    expect(refundText({ status: 'APPROVED', refundMethod: 'CASH' })).toBe('Efectivo de caja');
    expect(refundText({ status: 'PENDING_APPROVAL', refundMethod: 'CASH' })).toBe('Por aprobar');
  });

  it('shows the stop of a rejected return as a warning on the approval step', () => {
    const steps = timelineSteps({
      status: 'REJECTED',
      timeline: [
        { key: 'requested', state: 'done', at: '2026-11-09T15:00:00.000Z' },
        { key: 'approved', state: 'pending', at: null },
        { key: 'creditNote', state: 'pending', at: null },
        { key: 'refunded', state: 'pending', at: null },
      ],
    } as Pick<SaleReturnDetail, 'timeline' | 'status'>);
    expect(steps[1]).toMatchObject({ label: 'Rechazada', state: 'warning' });
    expect(steps[0].state).toBe('done');
  });
});
