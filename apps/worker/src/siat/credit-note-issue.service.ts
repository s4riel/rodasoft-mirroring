import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { type CreditNoteStatus, creditNoteMachine, Decimal, INVOICE_LEGEND_DEFAULT } from '@rodasoft/domain';
import { buildCuf, buildSignedCreditNoteXml, EmissionType, InvoiceDocumentType, ModalityCode, SectorDocumentType, SiatUnavailableError } from '@rodasoft/siat';
import type { SiatGateway, SiatSendResult } from '@rodasoft/siat';
import { PrismaService } from '../common/prisma.service';
import { SiatGatewayNotAvailableError, siatGatewayFor } from './siat-gateway';

export interface CreditNoteIssueInput {
  creditNoteId: string;
  companyId: string;
  /** A person asked for it: the API already moved the note to `SENDING`. The automatic first attempt finds it `PENDING`. */
  manual: boolean;
  userId?: string | null;
}

export type CreditNoteIssueOutcome = 'ACCEPTED' | 'REJECTED' | 'UNAVAILABLE' | 'SKIPPED';

type Tx = Prisma.TransactionClient;
type CallResult = SiatSendResult | { status: 'UNAVAILABLE'; error: string };

const noteInclude = {
  company: { select: { nit: true, legalName: true } },
  branch: { select: { code: true } },
  pointOfSale: { select: { id: true, code: true, cufdControlCode: true } },
  invoice: { select: { status: true, number: true, cuf: true, issuedAt: true, total: true, nitException: true, customerComplement: true } },
  items: { orderBy: { id: 'asc' }, select: { description: true, quantity: true, unitPrice: true, amount: true, saleItem: { select: { product: { select: { sku: true } } } } } },
} satisfies Prisma.CreditNoteInclude;

/**
 * Issues one credit and debit note against the SIAT (HU-FAC-12), with the rules of the invoice (`invoice-issue.service.ts`): no
 * contingency and no retry. When the SIAT does not answer the note goes back to `PENDING` and a person issues it again; the job
 * always completes.
 *
 * Three steps, so no transaction is open while the SIAT is called: (1) under the row lock, take the number from the
 * `NC-<branch>-<pos>` sequence, build the CUF and move to `SENDING`; (2) call the SIAT; (3) under the lock again, apply the answer.
 * A `SENDING` note that already has a CUF (a lost attempt) first asks the SIAT whether it got it, so nothing is sent twice. A note
 * whose invoice the SIAT does not hold as valid cannot be sent: it stays `PENDING` with `INVOICE_NOT_VALID`.
 */
@Injectable()
export class CreditNoteIssueService {
  private readonly logger = new Logger(CreditNoteIssueService.name);

  constructor(private readonly prisma: PrismaService) {}

  async issue(input: CreditNoteIssueInput, gateway?: SiatGateway): Promise<CreditNoteIssueOutcome> {
    let siat: SiatGateway;
    try {
      siat = gateway ?? (await siatGatewayFor(this.prisma, input.companyId));
    } catch (error) {
      if (!(error instanceof SiatGatewayNotAvailableError)) throw error;
      // misconfigured company: leave the note as it is and say so in the log; nothing is numbered or sent
      this.logger.warn(`Credit note ${input.creditNoteId}: ${error.message}`);
      return 'UNAVAILABLE';
    }
    const attempt = await this.prepare(input);
    if (attempt === 'SKIPPED' || attempt === 'UNAVAILABLE') return attempt;

    let result: CallResult;
    let cuf = attempt.cuf;
    let issuedAt = attempt.issuedAt;
    try {
      const previous = attempt.previousCuf ? await siat.invoiceStatus(attempt.previousCuf) : null;
      if (previous && previous.status !== 'UNKNOWN' && attempt.previousCuf && attempt.previousIssuedAt) {
        // the SIAT got the lost attempt: finish it with the data it was sent with
        cuf = attempt.previousCuf;
        issuedAt = attempt.previousIssuedAt;
        result = { status: 'ACCEPTED', receptionCode: previous.receptionCode ?? '', messages: [] };
      } else {
        result = await siat.sendCreditNote({
          cuf,
          number: attempt.number,
          issuedAt,
          issuerNit: attempt.issuerNit,
          customer: attempt.customer,
          total: attempt.total,
          invoiceCuf: attempt.invoiceCuf,
          reasonCode: attempt.reasonCode,
          xml: attempt.xml,
          nitException: attempt.nitException,
        });
      }
    } catch (error) {
      if (!(error instanceof SiatUnavailableError)) throw error;
      result = { status: 'UNAVAILABLE', error: error.message };
    }
    return this.apply(input, { result, cuf, issuedAt, xml: attempt.xml });
  }

  /** Step 1: lock, check, number, CUF, `SENDING`. */
  private async prepare(input: CreditNoteIssueInput) {
    return this.prisma.$transaction(async (tx) => {
      await this.lock(tx, input);
      const note = await tx.creditNote.findFirst({ where: { id: input.creditNoteId, companyId: input.companyId }, include: noteInclude });
      if (!note) return 'SKIPPED' as const;

      const status = note.status as CreditNoteStatus;
      const resumes = status === 'SENDING' && input.manual;
      if (status !== 'PENDING' && !resumes) return 'SKIPPED' as const;
      const now = new Date();

      const { invoice, pointOfSale } = note;
      const invoiceValid = invoice.status === 'VALID' && invoice.cuf !== null && invoice.number !== null && invoice.issuedAt !== null;
      const blocker = !pointOfSale ? 'POINT_OF_SALE_MISSING' : !invoiceValid ? 'INVOICE_NOT_VALID' : null;
      if (blocker || !pointOfSale || !invoice.cuf || invoice.number === null || !invoice.issuedAt) {
        // nothing can be sent: stay (or go back to) PENDING and say why
        const next = status === 'SENDING' ? creditNoteMachine.next('SENDING', 'unavailable') : status;
        await tx.creditNote.update({ where: { id: note.id }, data: { status: next, lastAttemptAt: now, lastError: blocker } });
        await this.audit(tx, input, 'invoicing.note.unavailable', { status }, { status: next, error: blocker });
        return 'UNAVAILABLE' as const;
      }

      const sending = status === 'PENDING' ? creditNoteMachine.next('PENDING', 'send') : 'SENDING';
      const number = note.number ?? (await this.nextNumber(tx, input.companyId, note.branch.code, pointOfSale.code));
      const issuedAt = now;
      const settings = await tx.siatSettings.findUnique({ where: { companyId: input.companyId }, select: { modality: true } });
      const cuf = buildCuf({
        nit: note.company.nit,
        issuedAt,
        branchCode: note.branch.code,
        modalityCode: settings?.modality === 'COMPUTERIZED_ONLINE' ? ModalityCode.ComputerizedOnline : ModalityCode.ElectronicOnline,
        emissionType: EmissionType.Online,
        invoiceDocumentType: InvoiceDocumentType.AdjustmentDocument,
        sectorDocumentType: SectorDocumentType.CreditDebitNote,
        invoiceNumber: number,
        pointOfSaleCode: pointOfSale.code,
        // the simulator accepts a fixed control code while the point of sale has no CUFD
        controlCode: pointOfSale.cufdControlCode ?? 'SIM0',
      });
      const customer = {
        name: note.customerTaxName,
        documentType: note.customerDocumentType,
        documentNumber: note.customerDocumentNumber,
        complement: invoice.customerComplement,
      };
      const total = Decimal.of(note.total.toString()).toString();
      // unsigned until the worker can read the company's certificate, like the invoice XML
      const xml = buildSignedCreditNoteXml(
        {
          issuerNit: note.company.nit,
          issuerName: note.company.legalName,
          branchCode: note.branch.code,
          pointOfSaleCode: pointOfSale.code,
          cuf,
          number,
          issuedAt,
          customer,
          invoiceNumber: invoice.number,
          invoiceCuf: invoice.cuf,
          invoiceIssuedAt: invoice.issuedAt,
          invoiceTotal: invoice.total.toFixed(2),
          reasonCode: note.reasonCode,
          total,
          vatAdjusted: note.vatAdjusted.toFixed(2),
          legend: INVOICE_LEGEND_DEFAULT,
          lines: note.items.map((item) => ({
            code: item.saleItem.product.sku,
            description: item.description,
            quantity: item.quantity,
            unitPrice: item.unitPrice.toFixed(2),
            amount: item.amount.toFixed(2),
          })),
        },
        null,
      );
      await tx.creditNote.update({ where: { id: note.id }, data: { status: sending, number, cuf, issuedAt, lastAttemptAt: now, lastError: null } });
      await this.audit(tx, input, 'invoicing.note.issue', { status }, { status: sending, number, cuf });
      return {
        number,
        cuf,
        issuedAt,
        xml,
        total,
        customer,
        issuerNit: note.company.nit,
        invoiceCuf: invoice.cuf,
        reasonCode: note.reasonCode,
        nitException: invoice.nitException,
        previousCuf: resumes ? note.cuf : null,
        previousIssuedAt: resumes ? note.issuedAt : null,
      };
    });
  }

  /** Step 3: apply the SIAT's answer under the row lock. */
  private async apply(input: CreditNoteIssueInput, outcome: { result: CallResult; cuf: string; issuedAt: Date; xml: string }): Promise<CreditNoteIssueOutcome> {
    const { result } = outcome;
    return this.prisma.$transaction(async (tx) => {
      await this.lock(tx, input);
      const note = await tx.creditNote.findFirst({ where: { id: input.creditNoteId, companyId: input.companyId }, select: { id: true, status: true, number: true } });
      if (!note || note.status !== 'SENDING') return 'SKIPPED' as const;

      if (result.status === 'ACCEPTED') {
        const next = creditNoteMachine.next('SENDING', 'accept');
        await tx.creditNote.update({
          where: { id: note.id },
          data: { status: next, cuf: outcome.cuf, issuedAt: outcome.issuedAt, siatReceptionCode: result.receptionCode, rejectionCode: null, rejectionMessage: null, lastError: null },
        });
        await tx.creditNoteDocument.upsert({
          where: { creditNoteId: note.id },
          create: { creditNoteId: note.id, companyId: input.companyId, signedXml: outcome.xml },
          update: { signedXml: outcome.xml },
        });
        await this.audit(tx, input, 'invoicing.note.accept', { status: 'SENDING' }, { status: next, number: note.number, cuf: outcome.cuf, receptionCode: result.receptionCode });
        return 'ACCEPTED' as const;
      }
      if (result.status === 'REJECTED') {
        const next = creditNoteMachine.next('SENDING', 'reject');
        const message = result.messages.map((m) => m.description).join('; ');
        await tx.creditNote.update({ where: { id: note.id }, data: { status: next, rejectionCode: result.code, rejectionMessage: message, lastError: null } });
        await this.audit(tx, input, 'invoicing.note.reject', { status: 'SENDING' }, { status: next, code: result.code, message });
        return 'REJECTED' as const;
      }
      const next = creditNoteMachine.next('SENDING', 'unavailable');
      await tx.creditNote.update({ where: { id: note.id }, data: { status: next, lastError: 'SIAT_UNAVAILABLE' } });
      await this.audit(tx, input, 'invoicing.note.unavailable', { status: 'SENDING' }, { status: next, error: result.error });
      this.logger.warn(`SIAT unavailable: credit note ${note.id} stays PENDING`);
      return 'UNAVAILABLE' as const;
    });
  }

  private async lock(tx: Tx, input: CreditNoteIssueInput): Promise<void> {
    await tx.$queryRaw`SELECT id FROM credit_notes WHERE id = ${input.creditNoteId}::uuid AND company_id = ${input.companyId}::uuid FOR UPDATE`;
  }

  /** The next note number of a point of sale: the counter row is locked until the transaction ends, so there is no gap or duplicate. */
  private async nextNumber(tx: Tx, companyId: string, branchCode: number, pointOfSaleCode: number): Promise<number> {
    const key = `NC-${branchCode}-${pointOfSaleCode}`;
    const [row] = await tx.$queryRaw<{ last: bigint }[]>`
      INSERT INTO document_sequences (id, company_id, key, last)
      VALUES (gen_random_uuid(), ${companyId}::uuid, ${key}, 1)
      ON CONFLICT (company_id, key) DO UPDATE SET last = document_sequences.last + 1
      RETURNING last`;
    return Number(row.last);
  }

  private async audit(tx: Tx, input: CreditNoteIssueInput, action: string, before: Prisma.InputJsonValue, after: Prisma.InputJsonValue) {
    await tx.auditLog.create({
      data: { companyId: input.companyId, userId: input.userId ?? null, action, entity: 'CreditNote', entityId: input.creditNoteId, before, after },
    });
  }
}
