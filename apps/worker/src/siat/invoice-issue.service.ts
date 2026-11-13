import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Decimal, INVOICE_LEGEND_DEFAULT, invoiceMachine } from '@rodasoft/domain';
import { buildCuf, buildSignedInvoiceXml, EmissionType, InvoiceDocumentType, ModalityCode, SectorDocumentType, SiatUnavailableError } from '@rodasoft/siat';
import type { SiatGateway, SiatSendResult } from '@rodasoft/siat';
import { PrismaService } from '../common/prisma.service';
import { SiatGatewayNotAvailableError, siatGatewayFor } from './siat-gateway';

export interface InvoiceIssueInput {
  invoiceId: string;
  companyId: string;
  /** A person asked for it: the API already moved the invoice to `SENDING`. The automatic first attempt finds it `PENDING`. */
  manual: boolean;
  userId?: string | null;
}

export type InvoiceIssueOutcome = 'ACCEPTED' | 'REJECTED' | 'UNAVAILABLE' | 'SKIPPED';

type Tx = Prisma.TransactionClient;

const invoiceInclude = {
  company: { select: { nit: true, legalName: true } },
  branch: { select: { code: true } },
  pointOfSale: { select: { id: true, code: true, cufdControlCode: true } },
  sale: { select: { items: { orderBy: { sortOrder: 'asc' }, select: { quantity: true, unitPrice: true, lineTotal: true, product: { select: { sku: true, name: true } } } } } },
} satisfies Prisma.InvoiceInclude;

/**
 * Issues one invoice against the SIAT (HU-FAC-01…10). There is no contingency: when the SIAT does not answer the invoice goes
 * back to `PENDING` and nothing is retried; a person issues it again when the SIAT is back. The job always completes.
 *
 * Three steps, so no transaction is open while the SIAT is called: (1) under the row lock, take the number, build the CUF and move
 * to `SENDING`; (2) call the SIAT; (3) under the lock again, apply the answer. A `SENDING` invoice that already has a CUF (a lost
 * attempt) first asks the SIAT whether it got it, so nothing is sent twice.
 */
@Injectable()
export class InvoiceIssueService {
  private readonly logger = new Logger(InvoiceIssueService.name);

  constructor(private readonly prisma: PrismaService) {}

  async issue(input: InvoiceIssueInput, gateway?: SiatGateway): Promise<InvoiceIssueOutcome> {
    let siat: SiatGateway;
    try {
      siat = gateway ?? (await siatGatewayFor(this.prisma, input.companyId));
    } catch (error) {
      if (!(error instanceof SiatGatewayNotAvailableError)) throw error;
      // misconfigured company: leave the invoice as it is (PENDING) and say so in the log; nothing is numbered or sent
      this.logger.warn(`Invoice ${input.invoiceId}: ${error.message}`);
      return 'UNAVAILABLE';
    }
    const attempt = await this.prepare(input);
    if (attempt === 'SKIPPED' || attempt === 'UNAVAILABLE') return attempt;

    let result: SiatSendResult | { status: 'UNAVAILABLE'; error: string };
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
        result = await siat.sendInvoice({
          cuf,
          number: attempt.number,
          issuedAt,
          issuerNit: attempt.issuerNit,
          customer: attempt.customer,
          total: attempt.total,
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
  private async prepare(input: InvoiceIssueInput) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM invoices WHERE id = ${input.invoiceId}::uuid AND company_id = ${input.companyId}::uuid FOR UPDATE`;
      const invoice = await tx.invoice.findFirst({ where: { id: input.invoiceId, companyId: input.companyId }, include: invoiceInclude });
      if (!invoice) return 'SKIPPED' as const;

      const resumes = invoice.status === 'SENDING' && input.manual;
      if (invoice.status !== 'PENDING' && !resumes) return 'SKIPPED' as const;
      const now = new Date();

      if (!invoice.pointOfSale) {
        // nothing can be numbered without a point of sale: stay (or go back to) PENDING and say why
        const next = invoice.status === 'SENDING' ? invoiceMachine.next('SENDING', 'unavailable') : invoice.status;
        await tx.invoice.update({ where: { id: invoice.id }, data: { status: next, lastAttemptAt: now, lastError: 'POINT_OF_SALE_MISSING' } });
        await this.audit(tx, input, 'invoicing.invoice.unavailable', { status: invoice.status }, { status: next, error: 'POINT_OF_SALE_MISSING' });
        return 'UNAVAILABLE' as const;
      }

      const sending = invoice.status === 'PENDING' ? invoiceMachine.next('PENDING', 'send') : 'SENDING';
      const number = invoice.number ?? (await this.nextNumber(tx, input.companyId, invoice.branch.code, invoice.pointOfSale.code));
      const issuedAt = now;
      const settings = await tx.siatSettings.findUnique({ where: { companyId: input.companyId }, select: { modality: true } });
      const cuf = buildCuf({
        nit: invoice.company.nit,
        issuedAt,
        branchCode: invoice.branch.code,
        modalityCode: settings?.modality === 'COMPUTERIZED_ONLINE' ? ModalityCode.ComputerizedOnline : ModalityCode.ElectronicOnline,
        emissionType: EmissionType.Online,
        invoiceDocumentType: InvoiceDocumentType.WithTaxCredit,
        sectorDocumentType: SectorDocumentType.PurchaseSale,
        invoiceNumber: number,
        pointOfSaleCode: invoice.pointOfSale.code,
        // the CUFD arrives with HU-FAC-22…26; the simulator accepts a fixed control code
        controlCode: invoice.pointOfSale.cufdControlCode ?? 'SIM0',
      });
      const customer = {
        name: invoice.customerTaxName,
        documentType: invoice.customerDocumentType,
        documentNumber: invoice.customerDocumentNumber,
        complement: invoice.customerComplement,
      };
      const total = Decimal.of(invoice.total.toString()).toString();
      // signed once the worker can read the company's certificate (SecretsService); until then the XML goes unsigned
      const xml = buildSignedInvoiceXml(
        {
          issuerNit: invoice.company.nit,
          issuerName: invoice.company.legalName,
          branchCode: invoice.branch.code,
          pointOfSaleCode: invoice.pointOfSale.code,
          cuf,
          number,
          issuedAt,
          customer,
          total,
          legend: INVOICE_LEGEND_DEFAULT,
          lines: invoice.sale.items.map((item) => ({
            code: item.product.sku,
            description: item.product.name,
            quantity: item.quantity,
            unitPrice: item.unitPrice.toString(),
            subtotal: item.lineTotal.toString(),
          })),
        },
        null,
      );
      await tx.invoice.update({
        where: { id: invoice.id },
        data: { status: sending, number, cuf, issuedAt, lastAttemptAt: now, lastError: null },
      });
      await this.audit(tx, input, 'invoicing.invoice.issue', { status: invoice.status }, { status: sending, number, cuf });
      return {
        number,
        cuf,
        issuedAt,
        xml,
        total,
        customer,
        issuerNit: invoice.company.nit,
        nitException: invoice.nitException,
        previousCuf: resumes ? invoice.cuf : null,
        previousIssuedAt: resumes ? invoice.issuedAt : null,
      };
    });
  }

  /** Step 3: apply the SIAT's answer under the row lock. */
  private async apply(
    input: InvoiceIssueInput,
    outcome: { result: SiatSendResult | { status: 'UNAVAILABLE'; error: string }; cuf: string; issuedAt: Date; xml: string },
  ): Promise<InvoiceIssueOutcome> {
    const { result } = outcome;
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM invoices WHERE id = ${input.invoiceId}::uuid AND company_id = ${input.companyId}::uuid FOR UPDATE`;
      const invoice = await tx.invoice.findFirst({ where: { id: input.invoiceId, companyId: input.companyId }, select: { id: true, status: true, number: true } });
      if (!invoice || invoice.status !== 'SENDING') return 'SKIPPED' as const;

      if (result.status === 'ACCEPTED') {
        const next = invoiceMachine.next('SENDING', 'accept');
        await tx.invoice.update({
          where: { id: invoice.id },
          data: { status: next, cuf: outcome.cuf, issuedAt: outcome.issuedAt, siatReceptionCode: result.receptionCode, rejectionCode: null, rejectionMessage: null, lastError: null },
        });
        await tx.invoiceDocument.upsert({
          where: { invoiceId: invoice.id },
          create: { invoiceId: invoice.id, companyId: input.companyId, signedXml: outcome.xml },
          update: { signedXml: outcome.xml },
        });
        await this.audit(tx, input, 'invoicing.invoice.accept', { status: 'SENDING' }, { status: next, number: invoice.number, cuf: outcome.cuf, receptionCode: result.receptionCode });
        return 'ACCEPTED' as const;
      }
      if (result.status === 'REJECTED') {
        const next = invoiceMachine.next('SENDING', 'reject');
        const message = result.messages.map((m) => m.description).join('; ');
        await tx.invoice.update({ where: { id: invoice.id }, data: { status: next, rejectionCode: result.code, rejectionMessage: message, lastError: null } });
        await this.audit(tx, input, 'invoicing.invoice.reject', { status: 'SENDING' }, { status: next, code: result.code, message });
        return 'REJECTED' as const;
      }
      const next = invoiceMachine.next('SENDING', 'unavailable');
      await tx.invoice.update({ where: { id: invoice.id }, data: { status: next, lastError: 'SIAT_UNAVAILABLE' } });
      await this.audit(tx, input, 'invoicing.invoice.unavailable', { status: 'SENDING' }, { status: next, error: result.error });
      this.logger.warn(`SIAT unavailable: invoice ${invoice.id} stays PENDING`);
      return 'UNAVAILABLE' as const;
    });
  }

  /** The next invoice number of a point of sale: the counter row is locked until the transaction ends, so there is no gap or duplicate. */
  private async nextNumber(tx: Tx, companyId: string, branchCode: number, pointOfSaleCode: number): Promise<number> {
    const key = `INV-${branchCode}-${pointOfSaleCode}`;
    const [row] = await tx.$queryRaw<{ last: bigint }[]>`
      INSERT INTO document_sequences (id, company_id, key, last)
      VALUES (gen_random_uuid(), ${companyId}::uuid, ${key}, 1)
      ON CONFLICT (company_id, key) DO UPDATE SET last = document_sequences.last + 1
      RETURNING last`;
    return Number(row.last);
  }

  private async audit(tx: Tx, input: InvoiceIssueInput, action: string, before: Prisma.InputJsonValue, after: Prisma.InputJsonValue) {
    await tx.auditLog.create({
      data: { companyId: input.companyId, userId: input.userId ?? null, action, entity: 'Invoice', entityId: input.invoiceId, before, after },
    });
  }
}
