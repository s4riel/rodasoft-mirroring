import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  type CreateCreditNoteInput,
  type CreditableLine,
  type CreditNoteStatus,
  creditNoteMachine,
  creditNoteTotal,
  creditNoteVat,
  Decimal,
  type InvoiceStatus,
  isCreditNoteReasonCode,
  isInvoiceCreditable,
  isStuckSending,
  proRata,
  validateCreditNote,
} from '@rodasoft/domain';
import { ClsService } from 'nestjs-cls';
import { AuditService } from '../../common/audit/audit.service';
import type { AppClsStore } from '../../common/cls';
import { OutboxService } from '../../common/outbox/outbox.service';
import { PrismaService, type TenantTransaction } from '../../common/prisma/prisma.service';
import { SettingsService } from '../../common/settings/settings.service';
import { SaleVisibilityService } from '../sales/sales/sale-visibility.service';
import { creditableLines } from './creditable-lines';
import { invoicingErrors } from './invoicing.errors';

const asTx = (tx: TenantTransaction) => tx as unknown as Prisma.TransactionClient;
const money = (value: Prisma.Decimal) => Decimal.of(value.toFixed(2));

/**
 * What a person does to a credit and debit note (HU-FAC-12): issue one without a return to adjust a price (only when the company
 * allows it), and issue by hand a note that is `PENDING` or `REJECTED`. The attempt itself runs in the worker
 * (`credit-note.issue`); here the rows are locked, the state moves through `creditNoteMachine` and the event is published in the
 * same transaction. A note of a return is created by the return (`sale-returns.service.ts`).
 *
 * Lock order: the sale row `FOR UPDATE` (the lock a return takes, so a return and a price adjustment of one sale never run
 * together), then the note.
 */
@Injectable()
export class CreditNotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cls: ClsService<AppClsStore>,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly settings: SettingsService,
    private readonly visibility: SaleVisibilityService,
  ) {}

  /** A price-adjustment note of a valid invoice: money credited on its lines, no pieces coming back, no return. */
  async createPriceAdjustment(invoiceId: string, input: CreateCreditNoteInput): Promise<{ id: string }> {
    if (!isCreditNoteReasonCode(input.reasonCode)) throw invoicingErrors.invalidNote([{ field: 'reasonCode', error: 'REASON_INVALID' }]);
    const companyId = this.cls.get('companyId') ?? '';
    const scope = await this.visibility.resolve();

    return this.prisma.tenant.$transaction(async (tx) => {
      if (!(await this.settings.get('invoicing.allowPriceAdjustmentNotes', tx))) throw invoicingErrors.priceAdjustmentNotAllowed();
      const visible = await tx.invoice.findFirst({ where: { AND: [{ sale: scope.where }, { id: invoiceId }] }, select: { saleId: true } });
      if (!visible) throw invoicingErrors.notFound();
      // the sale lock serialises two notes of one invoice: the second one sees what the first credited
      await tx.$queryRaw`SELECT id FROM sales WHERE id = ${visible.saleId}::uuid AND company_id = ${companyId}::uuid FOR UPDATE`;
      const invoice = await tx.invoice.findFirstOrThrow({ where: { id: invoiceId } });
      if (!isInvoiceCreditable(invoice.status as InvoiceStatus)) throw invoicingErrors.invoiceNotCreditable(invoice.status);

      const lines = await creditableLines(tx, invoice);
      const issues = validateCreditNote(lines, input.items);
      const exceeded = issues.filter((issue) => issue.code === 'CREDIT_EXCEEDS_INVOICED');
      if (exceeded.length > 0) throw invoicingErrors.creditExceedsInvoiced(exceeded);
      if (issues.length > 0) throw invoicingErrors.invalidNote(issues.map((issue) => ({ field: 'items', error: issue.code, saleItemId: issue.saleItemId })));

      // the lines are pro-rated to the cent, so the invoice total is the last word on what can still be credited
      const total = creditNoteTotal(input.items);
      const creditedBefore = lines.reduce((acc, line) => acc.add(Decimal.of(line.creditedAmount)), Decimal.zero());
      const left = money(invoice.total).sub(creditedBefore);
      if (total.cmp(left) > 0) throw invoicingErrors.creditExceedsInvoiced([{ code: 'CREDIT_EXCEEDS_INVOICED', creditableAmount: (left.isNegative() ? Decimal.zero() : left).toString() }]);

      const saleItems = await tx.saleItem.findMany({
        where: { id: { in: input.items.map((item) => item.saleItemId) } },
        select: { id: true, unitPrice: true, product: { select: { name: true } } },
      });
      const byId = new Map(saleItems.map((item) => [item.id, item]));
      const note = await tx.creditNote.create({
        data: {
          companyId,
          invoiceId: invoice.id,
          branchId: invoice.branchId,
          pointOfSaleId: invoice.pointOfSaleId,
          status: 'PENDING',
          total: total.toString(),
          vatAdjusted: creditNoteVat(total).toString(),
          reasonCode: input.reasonCode,
          customerTaxName: invoice.customerTaxName,
          customerDocumentType: invoice.customerDocumentType,
          customerDocumentNumber: invoice.customerDocumentNumber,
          items: {
            create: input.items.map((item) => {
              const saleItem = byId.get(item.saleItemId);
              if (!saleItem) throw invoicingErrors.invalidNote([{ field: 'items', error: 'SALE_ITEM_NOT_FOUND', saleItemId: item.saleItemId }]);
              return {
                companyId,
                saleItemId: item.saleItemId,
                description: saleItem.product.name,
                quantity: item.quantity,
                unitPrice: saleItem.unitPrice.toFixed(2),
                amount: Decimal.of(item.amount).toString(),
              };
            }),
          },
        },
        select: { id: true },
      });
      await this.audit.log(
        {
          action: 'invoicing.note.create',
          entity: 'CreditNote',
          entityId: note.id,
          after: { status: 'PENDING', invoiceId: invoice.id, total: total.toString(), reasonCode: input.reasonCode, priceAdjustment: true },
        },
        asTx(tx),
      );
      // the person asked to issue it: the first attempt goes with the note, whatever `invoicing.autoIssueOnSale` says
      await this.outbox.publish(
        'credit-note.issue',
        { creditNoteId: note.id, attempt: 1, manual: false, userId: this.cls.get('userId') },
        { tx: asTx(tx), idempotencyKey: `credit-note-issue:${note.id}:1` },
      );
      return note;
    });
  }

  /** Gives up a note the SIAT never validated (`PENDING` or `REJECTED`): it stops reserving what it credited of the invoice. */
  async voidNote(noteId: string): Promise<void> {
    const companyId = this.cls.get('companyId') ?? '';
    const scope = await this.visibility.resolve();
    await this.prisma.tenant.$transaction(async (tx) => {
      const visible = await tx.creditNote.findFirst({ where: { AND: [{ invoice: { sale: scope.where } }, { id: noteId }] }, select: { id: true } });
      if (!visible) throw invoicingErrors.noteNotFound();
      await tx.$queryRaw`SELECT id FROM credit_notes WHERE id = ${noteId}::uuid AND company_id = ${companyId}::uuid FOR UPDATE`;
      const note = await tx.creditNote.findFirstOrThrow({ where: { id: noteId }, select: { id: true, status: true } });
      const status = note.status as CreditNoteStatus;
      if (!creditNoteMachine.can(status, 'void')) throw invoicingErrors.noteNotVoidable(status);
      const next = creditNoteMachine.next(status, 'void');
      await tx.creditNote.update({ where: { id: note.id }, data: { status: next } });
      await this.audit.log({ action: 'invoicing.note.void', entity: 'CreditNote', entityId: note.id, before: { status }, after: { status: next } }, asTx(tx));
    });
  }

  /** Issues one note by hand (`PENDING`, `REJECTED`, or a `SENDING` one lost long ago). */
  async issue(noteId: string): Promise<void> {
    const companyId = this.cls.get('companyId') ?? '';
    const scope = await this.visibility.resolve();
    await this.prisma.tenant.$transaction(async (tx) => {
      const visible = await tx.creditNote.findFirst({ where: { AND: [{ invoice: { sale: scope.where } }, { id: noteId }] }, select: { id: true } });
      if (!visible) throw invoicingErrors.noteNotFound();
      await tx.$queryRaw`SELECT id FROM credit_notes WHERE id = ${noteId}::uuid AND company_id = ${companyId}::uuid FOR UPDATE`;
      const note = await tx.creditNote.findFirstOrThrow({ where: { id: noteId }, select: { id: true, status: true, lastAttemptAt: true } });
      const status = note.status as CreditNoteStatus;
      const now = new Date();

      let next: CreditNoteStatus = status;
      if (status === 'SENDING') {
        const timeout = await this.settings.get('invoicing.sendingTimeoutMinutes', tx);
        if (!isStuckSending(note.lastAttemptAt, now, timeout)) throw invoicingErrors.noteAlreadySending();
      } else if (status === 'PENDING' || status === 'REJECTED') {
        // a rejected note is fixed and sent in one step: what was wrong lives in the invoice or in the SIAT, not in the note
        const pending = status === 'REJECTED' ? creditNoteMachine.next('REJECTED', 'fix') : status;
        next = creditNoteMachine.next(pending, 'send');
      } else {
        throw invoicingErrors.noteNotIssuable(status);
      }

      await tx.creditNote.update({ where: { id: note.id }, data: { status: next, lastAttemptAt: now, lastError: null } });
      await this.audit.log(
        { action: 'invoicing.note.issue', entity: 'CreditNote', entityId: note.id, before: { status }, after: { status: next, manual: true } },
        asTx(tx),
      );
      await this.outbox.publish(
        'credit-note.issue',
        { creditNoteId: note.id, manual: true, userId: this.cls.get('userId') },
        { tx: asTx(tx), idempotencyKey: `credit-note-issue:${note.id}:${now.getTime()}` },
      );
    });
  }
}
