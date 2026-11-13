import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  canResend,
  IdentityDocumentType,
  type InvoiceBulkResult,
  invoiceMachine,
  type InvoiceStatus,
  isStuckSending,
  normalizeNit,
  validateInvoiceDocument,
} from '@rodasoft/domain';
import { SiatUnavailableError } from '@rodasoft/siat';
import { ClsService } from 'nestjs-cls';
import { AuditService } from '../../common/audit/audit.service';
import type { AppClsStore } from '../../common/cls';
import { OutboxService } from '../../common/outbox/outbox.service';
import { PrismaService, type TenantTransaction } from '../../common/prisma/prisma.service';
import { SettingsService } from '../../common/settings/settings.service';
import { SiatGatewayFactory } from '../../common/siat/siat-gateway.factory';
import type { UpdateInvoiceCustomerDto } from './invoicing.dto';
import { invoicingErrors } from './invoicing.errors';

interface LockedInvoice {
  id: string;
  status: InvoiceStatus;
  lastAttemptAt: Date | null;
  customerDocumentType: number;
  customerDocumentNumber: string;
  nitVerifiedAt: Date | null;
  nitException: boolean;
}

/**
 * What a person does to an invoice before and while issuing it (HU-FAC-01, HU-FAC-07): issue it, fix the customer, verify the NIT
 * with the SIN and send it again. The attempt itself runs in the worker; here the invoice is locked, moved to `SENDING` and the
 * `invoice.issue` event is published in the same transaction. There is no contingency and no automatic retry.
 */
@Injectable()
export class InvoiceIssuingService {
  private readonly logger = new Logger(InvoiceIssuingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cls: ClsService<AppClsStore>,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly settings: SettingsService,
    private readonly gateways: SiatGatewayFactory,
  ) {}

  /** Issues one invoice by hand (`PENDING`, a `REJECTED` one that can be sent again, or a `SENDING` one lost long ago). */
  async issue(invoiceId: string): Promise<void> {
    await this.prisma.tenant.$transaction(async (tx) => {
      const invoice = await this.lock(tx, invoiceId);
      const now = new Date();
      const timeout = await this.settings.get('invoicing.sendingTimeoutMinutes', tx);

      let next: InvoiceStatus = invoice.status;
      if (invoice.status === 'SENDING') {
        if (!isStuckSending(invoice.lastAttemptAt, now, timeout)) throw invoicingErrors.alreadySending();
      } else if (invoice.status === 'PENDING' || invoice.status === 'REJECTED') {
        if (
          !canResend({
            status: invoice.status,
            documentType: invoice.customerDocumentType,
            nitVerifiedAt: invoice.nitVerifiedAt,
            nitException: invoice.nitException,
          })
        ) {
          throw invoicingErrors.nitNotVerified();
        }
        if (invoice.status === 'REJECTED') invoiceMachine.next('REJECTED', 'fix');
        next = invoiceMachine.next('PENDING', 'send');
      } else {
        throw invoicingErrors.notIssuable(invoice.status);
      }

      await tx.invoice.update({ where: { id: invoice.id }, data: { status: next, lastAttemptAt: now, lastError: null } });
      await this.audit.log(
        { action: 'invoicing.invoice.issue', entity: 'Invoice', entityId: invoice.id, before: { status: invoice.status }, after: { status: next, manual: true } },
        tx as unknown as Prisma.TransactionClient,
      );
      await this.outbox.publish(
        'invoice.issue',
        { invoiceId: invoice.id, manual: true, userId: this.cls.get('userId') },
        { tx: tx as unknown as Prisma.TransactionClient, idempotencyKey: `invoice-issue:${invoice.id}:${now.getTime()}` },
      );
    });
  }

  /** Sends a rejected invoice again: the same rules as issuing (a verified NIT or an approved exception), the fix and send happen together. */
  resend(invoiceId: string): Promise<void> {
    return this.issue(invoiceId);
  }

  /** Issues up to 50 invoices; one that cannot be issued does not stop the others. */
  async issueMany(ids: string[]): Promise<InvoiceBulkResult[]> {
    const results: InvoiceBulkResult[] = [];
    for (const id of [...new Set(ids)]) {
      try {
        await this.issue(id);
        results.push({ id, ok: true });
      } catch (error) {
        const code = (error as { getResponse?: () => { code?: string } }).getResponse?.().code;
        if (!code) this.logger.error(`Issuing invoice ${id} failed`, error instanceof Error ? error.stack : String(error));
        results.push({ id, ok: false, code: code ?? 'UNKNOWN' });
      }
    }
    return results;
  }

  /** Fixes the customer of an invoice that has not been accepted (HU-FAC-07). A new document must be verified again. */
  async updateCustomer(invoiceId: string, dto: UpdateInvoiceCustomerDto): Promise<void> {
    const check = validateInvoiceDocument(dto.documentType, dto.documentNumber, dto.complement);
    if (!check.valid) throw invoicingErrors.invalidNit(check.error);
    await this.prisma.tenant.$transaction(async (tx) => {
      const invoice = await this.lock(tx, invoiceId);
      if (invoice.status !== 'PENDING' && invoice.status !== 'REJECTED') throw invoicingErrors.notEditable(invoice.status);
      const documentChanged = invoice.customerDocumentType !== dto.documentType || invoice.customerDocumentNumber !== check.documentNumber;
      await tx.invoice.update({
        where: { id: invoice.id },
        data: {
          customerTaxName: dto.name,
          customerDocumentType: dto.documentType,
          customerDocumentNumber: check.documentNumber,
          customerComplement: check.complement,
          // a different document is a different NIT for the SIN; the old verification no longer counts
          // and an exception approved for the old NIT does not cover the new one
          ...(documentChanged ? { nitVerifiedAt: null, nitException: false } : {}),
        },
      });
      await this.audit.log(
        {
          action: 'invoicing.invoice.correct',
          entity: 'Invoice',
          entityId: invoice.id,
          before: { documentType: invoice.customerDocumentType, documentNumber: invoice.customerDocumentNumber },
          after: { documentType: dto.documentType, documentNumber: check.documentNumber, name: dto.name },
        },
        tx as unknown as Prisma.TransactionClient,
      );
    });
  }

  /** Asks the SIN whether it knows the NIT of the invoice (HU-FAC-07). Only a NIT needs it; any other document is accepted as is. */
  async verifyNit(invoiceId: string): Promise<{ valid: boolean; messages: { code: number; description: string }[] }> {
    const invoice = await this.prisma.tenant.invoice.findFirst({
      where: { id: invoiceId },
      select: { id: true, status: true, customerDocumentType: true, customerDocumentNumber: true },
    });
    if (!invoice) throw invoicingErrors.notFound();
    if (invoice.status !== 'PENDING' && invoice.status !== 'REJECTED') throw invoicingErrors.notEditable(invoice.status);
    if (invoice.customerDocumentType !== IdentityDocumentType.NIT) return { valid: true, messages: [] };

    const gateway = await this.gateways.forCurrentCompany();
    let result: { valid: boolean; messages: { code: number; description: string }[] };
    try {
      result = await gateway.verifyNit(normalizeNit(invoice.customerDocumentNumber));
    } catch (error) {
      if (error instanceof SiatUnavailableError) throw invoicingErrors.siatUnavailable();
      throw error;
    }
    await this.prisma.tenant.$transaction(async (tx) => {
      if (result.valid) {
        // the customer may have been corrected while the SIN answered: only the NIT that was checked is verified
        const current = await this.lock(tx, invoice.id);
        if (current.customerDocumentType === invoice.customerDocumentType && current.customerDocumentNumber === invoice.customerDocumentNumber) {
          await tx.invoice.update({ where: { id: invoice.id }, data: { nitVerifiedAt: new Date() } });
        } else {
          result = { valid: false, messages: [{ code: 0, description: 'Los datos del cliente cambiaron mientras se verificaba. Verifica de nuevo.' }] };
        }
      }
      await this.audit.log(
        {
          action: 'invoicing.invoice.verify-nit',
          entity: 'Invoice',
          entityId: invoice.id,
          after: { valid: result.valid, message: result.messages.map((m) => m.description).join('; ') || undefined },
        },
        tx as unknown as Prisma.TransactionClient,
      );
    });
    return result;
  }

  /** Locks the invoice row (visible to the company only) and returns what the decisions need. */
  private async lock(tx: TenantTransaction, invoiceId: string): Promise<LockedInvoice> {
    const companyId = this.cls.get('companyId') ?? '';
    const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM invoices WHERE id = ${invoiceId}::uuid AND company_id = ${companyId}::uuid FOR UPDATE`;
    if (locked.length === 0) throw invoicingErrors.notFound();
    const invoice = await tx.invoice.findFirst({
      where: { id: invoiceId },
      select: { id: true, status: true, lastAttemptAt: true, customerDocumentType: true, customerDocumentNumber: true, nitVerifiedAt: true, nitException: true },
    });
    if (!invoice) throw invoicingErrors.notFound();
    return { ...invoice, status: invoice.status as InvoiceStatus };
  }
}
