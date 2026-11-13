import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { type InvoiceStatus, NIT_EXCEPTION_REASON_MAX, validateNitExceptionRequest } from '@rodasoft/domain';
import { ClsService } from 'nestjs-cls';
import { AuditService } from '../../common/audit/audit.service';
import type { AppClsStore } from '../../common/cls';
import { OutboxService } from '../../common/outbox/outbox.service';
import { PrismaService, type TenantTransaction } from '../../common/prisma/prisma.service';
import { SettingsService } from '../../common/settings/settings.service';
import { InvoiceIssuingService } from './invoice-issuing.service';
import { invoicingErrors } from './invoicing.errors';

/**
 * Issuing an invoice with a NIT the SIN does not recognise (HU-FAC-08, decision #21). A person with `invoicing.invoices.issue` asks
 * with a reason; a person with `invoicing.nit-exception.approve` decides. An approval marks the invoice and sends it again with the
 * exception, so the SIN accepts it; a rejection leaves it as it was. Everything is audited and each request waits in the approvals inbox.
 */
@Injectable()
export class InvoiceNitExceptionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cls: ClsService<AppClsStore>,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly settings: SettingsService,
    private readonly issuing: InvoiceIssuingService,
  ) {}

  async request(invoiceId: string, input: { reason: string }): Promise<void> {
    const errors = validateNitExceptionRequest({ reason: input.reason });
    if (errors.length > 0) throw invoicingErrors.invalidReason('reason', errors[0]);
    const reason = input.reason.trim().slice(0, NIT_EXCEPTION_REASON_MAX);
    if (!(await this.settings.get('invoicing.allowNitException'))) throw invoicingErrors.nitExceptionDisabled();

    const companyId = this.companyId();
    await this.prisma.tenant.$transaction(async (tx) => {
      const invoice = await this.lock(tx, invoiceId);
      // only an invoice the SIN refused (or one still waiting) can need the exception
      if (invoice.status !== 'REJECTED' && invoice.status !== 'PENDING') throw invoicingErrors.notIssuable(invoice.status);
      if (invoice.nitException) throw invoicingErrors.nitExceptionAlreadyApproved();
      try {
        await tx.approvalRequest.create({
          data: { companyId, type: 'NIT_EXCEPTION', subjectId: invoiceId, requestedById: this.userId(), reason: 'NIT_EXCEPTION', requesterComment: reason },
        });
      } catch (err) {
        // the partial unique index: a pending request exists for this invoice
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') throw invoicingErrors.nitExceptionAlreadyPending();
        throw err;
      }
      const db = tx as unknown as Prisma.TransactionClient;
      await this.audit.log({ action: 'invoicing.invoice.nit-exception-request', entity: 'Invoice', entityId: invoiceId, after: { reason } }, db);
      await this.outbox.publish('invoicing.nit-exception.requested', { invoiceId, reason }, { tx: db });
    });
  }

  /** Approves: the invoice carries the exception and is sent again right away. */
  async approve(invoiceId: string, input: { comment?: string }): Promise<void> {
    await this.decide(invoiceId, input, true);
    // the exception is committed; sending is a separate attempt, like any manual issue
    await this.issuing.issue(invoiceId);
  }

  async reject(invoiceId: string, input: { comment?: string }): Promise<void> {
    await this.decide(invoiceId, input, false);
  }

  private async decide(invoiceId: string, input: { comment?: string }, approve: boolean): Promise<void> {
    const comment = input.comment?.trim() || null;
    // a rejection must say why: the cashier reads it
    if (!approve && !comment) throw invoicingErrors.invalidReason('comment', 'COMMENT_REQUIRED');
    await this.prisma.tenant.$transaction(async (tx) => {
      await this.lock(tx, invoiceId);
      const request = await tx.approvalRequest.findFirst({ where: { type: 'NIT_EXCEPTION', subjectId: invoiceId, status: 'PENDING' }, select: { id: true } });
      if (!request) throw invoicingErrors.nitExceptionNotPending();
      const status = approve ? 'APPROVED' : 'REJECTED';
      await tx.approvalRequest.update({ where: { id: request.id }, data: { status, decidedById: this.userId(), decidedAt: new Date(), comment } });
      if (approve) await tx.invoice.update({ where: { id: invoiceId }, data: { nitException: true } });
      const db = tx as unknown as Prisma.TransactionClient;
      await this.audit.log(
        { action: approve ? 'invoicing.invoice.nit-exception-approve' : 'invoicing.invoice.nit-exception-reject', entity: 'Invoice', entityId: invoiceId, after: { comment } },
        db,
      );
      await this.outbox.publish('invoicing.nit-exception.decided', { invoiceId, status }, { tx: db });
    });
  }

  private async lock(tx: TenantTransaction, invoiceId: string): Promise<{ status: InvoiceStatus; nitException: boolean }> {
    const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM invoices WHERE id = ${invoiceId}::uuid AND company_id = ${this.companyId()}::uuid FOR UPDATE`;
    if (locked.length === 0) throw invoicingErrors.notFound();
    const invoice = await tx.invoice.findFirst({ where: { id: invoiceId }, select: { status: true, nitException: true } });
    if (!invoice) throw invoicingErrors.notFound();
    return { status: invoice.status as InvoiceStatus, nitException: invoice.nitException };
  }

  private companyId(): string {
    return this.cls.get('companyId') ?? '';
  }

  private userId(): string {
    return this.cls.get('userId') ?? '';
  }
}
