import { BadRequestException, Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Res, StreamableFile, ValidationError, ValidationPipe } from '@nestjs/common';
import type { Response } from 'express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { InvoiceBulkResult, InvoiceCancellationsResponse, InvoiceDetail, InvoiceListResponse, InvoicingStatus } from '@rodasoft/domain';
import { RequirePermissions } from '../access/require-permissions.decorator';
import { InvoiceCancellationsService } from './invoice-cancellations.service';
import { InvoiceDocumentsService, type InvoiceFile } from './invoice-documents.service';
import { InvoiceIssuingService } from './invoice-issuing.service';
import { InvoiceNitExceptionService } from './invoice-nit-exception.service';
import { InvoiceQueriesService } from './invoice-queries.service';
import { DeliverInvoiceDto, DownloadInvoicesDto, InvoiceCancellationRequestDto, IssueInvoicesDto, ListInvoicesQueryDto, NitExceptionDecisionDto, NitExceptionRequestDto, UpdateInvoiceCustomerDto } from './invoicing.dto';
import { invoicingErrors } from './invoicing.errors';

const validation = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
  exceptionFactory: (errors: ValidationError[]) =>
    new BadRequestException({
      code: 'VALIDATION_FAILED',
      message: 'Invalid request',
      details: errors.map((e) => ({ field: e.property, constraints: e.constraints })),
    }),
});
/** A malformed id is simply an invoice that does not exist. */
const invoiceIdPipe = new ParseUUIDPipe({ exceptionFactory: () => invoicingErrors.notFound() });

/** SIAT invoicing: the list, the detail and issuing by hand (HU-FAC-01…04, HU-FAC-07). */
@ApiTags('invoicing')
@ApiBearerAuth()
@Controller('invoicing')
export class InvoicingController {
  constructor(
    private readonly queries: InvoiceQueriesService,
    private readonly issuing: InvoiceIssuingService,
    private readonly documents: InvoiceDocumentsService,
    private readonly nitException: InvoiceNitExceptionService,
    private readonly cancellations: InvoiceCancellationsService,
  ) {}

  @Get('status')
  @RequirePermissions('invoicing.invoices.view')
  status(): Promise<InvoicingStatus> {
    return this.queries.status();
  }

  @Get('invoices')
  @RequirePermissions('invoicing.invoices.view')
  list(@Query(validation) query: ListInvoicesQueryDto): Promise<InvoiceListResponse> {
    return this.queries.list(query);
  }

  @Get('invoices/:id')
  @RequirePermissions('invoicing.invoices.view')
  detail(@Param('id', invoiceIdPipe) id: string): Promise<InvoiceDetail> {
    return this.queries.detail(id);
  }

  @Post('invoices/issue')
  @HttpCode(200)
  @RequirePermissions('invoicing.invoices.issue')
  async issueMany(@Body(validation) dto: IssueInvoicesDto): Promise<{ results: InvoiceBulkResult[] }> {
    return { results: await this.issuing.issueMany(dto.ids) };
  }

  @Post('invoices/:id/issue')
  @HttpCode(204)
  @RequirePermissions('invoicing.invoices.issue')
  issue(@Param('id', invoiceIdPipe) id: string): Promise<void> {
    return this.issuing.issue(id);
  }

  @Post('invoices/:id/resend')
  @HttpCode(204)
  @RequirePermissions('invoicing.invoices.issue')
  resend(@Param('id', invoiceIdPipe) id: string): Promise<void> {
    return this.issuing.resend(id);
  }

  @Patch('invoices/:id/customer')
  @HttpCode(204)
  @RequirePermissions('invoicing.invoices.issue')
  updateCustomer(@Param('id', invoiceIdPipe) id: string, @Body(validation) dto: UpdateInvoiceCustomerDto): Promise<void> {
    return this.issuing.updateCustomer(id, dto);
  }

  @Get('invoices/:id/pdf')
  @RequirePermissions('invoicing.invoices.view')
  async pdf(@Param('id', invoiceIdPipe) id: string, @Res({ passthrough: true }) res: Response): Promise<StreamableFile> {
    return this.file(res, await this.documents.pdfOf(id));
  }

  @Get('invoices/:id/xml')
  @RequirePermissions('invoicing.invoices.view')
  async xml(@Param('id', invoiceIdPipe) id: string, @Res({ passthrough: true }) res: Response): Promise<StreamableFile> {
    return this.file(res, await this.documents.xmlOf(id));
  }

  /** A ZIP with one file per issued invoice; `X-Invoices-Skipped` lists the ids left out. */
  @Post('invoices/download')
  @HttpCode(200)
  @RequirePermissions('invoicing.invoices.view')
  async download(@Body(validation) dto: DownloadInvoicesDto, @Res({ passthrough: true }) res: Response): Promise<StreamableFile> {
    const result = await this.documents.download(dto.ids, dto.format);
    res.setHeader('X-Invoices-Included', result.included.join(','));
    res.setHeader('X-Invoices-Skipped', result.skipped.join(','));
    res.setHeader('Access-Control-Expose-Headers', 'X-Invoices-Included, X-Invoices-Skipped, Content-Disposition');
    return this.file(res, result);
  }

  @Post('invoices/deliveries')
  @HttpCode(200)
  @RequirePermissions('invoicing.invoices.view')
  async deliverMany(@Body(validation) dto: IssueInvoicesDto): Promise<{ results: InvoiceBulkResult[] }> {
    return { results: await this.documents.deliverMany(dto.ids) };
  }

  @Post('invoices/:id/deliveries')
  @HttpCode(200)
  @RequirePermissions('invoicing.invoices.view')
  deliver(@Param('id', invoiceIdPipe) id: string, @Body(validation) dto: DeliverInvoiceDto) {
    return this.documents.deliver(id, dto.channel, dto.recipient);
  }

  @Post('invoices/:id/nit-exception')
  @HttpCode(204)
  @RequirePermissions('invoicing.invoices.issue')
  requestNitException(@Param('id', invoiceIdPipe) id: string, @Body(validation) dto: NitExceptionRequestDto): Promise<void> {
    return this.nitException.request(id, dto);
  }

  @Post('invoices/:id/nit-exception/approve')
  @HttpCode(204)
  @RequirePermissions('invoicing.nit-exception.approve')
  approveNitException(@Param('id', invoiceIdPipe) id: string, @Body(validation) dto: NitExceptionDecisionDto): Promise<void> {
    return this.nitException.approve(id, dto);
  }

  @Post('invoices/:id/nit-exception/reject')
  @HttpCode(204)
  @RequirePermissions('invoicing.nit-exception.approve')
  rejectNitException(@Param('id', invoiceIdPipe) id: string, @Body(validation) dto: NitExceptionDecisionDto): Promise<void> {
    return this.nitException.reject(id, dto);
  }

  /** Asks Management to cancel the invoice (and its sale) in the SIAT; the invoice stays valid until the approval. */
  @Post('invoices/:id/cancellation-request')
  @HttpCode(200)
  @RequirePermissions('sales.cancellations.request')
  requestCancellation(@Param('id', invoiceIdPipe) id: string, @Body(validation) dto: InvoiceCancellationRequestDto) {
    return this.cancellations.request(id, dto);
  }

  /** The cancellations waiting for Management. */
  @Get('cancellations')
  @RequirePermissions('sales.cancellations.approve')
  pendingCancellations(): Promise<InvoiceCancellationsResponse> {
    return this.cancellations.pending();
  }

  @Post('invoices/:id/verify-nit')
  @HttpCode(200)
  @RequirePermissions('invoicing.invoices.issue')
  verifyNit(@Param('id', invoiceIdPipe) id: string) {
    return this.issuing.verifyNit(id);
  }

  private file(res: Response, file: InvoiceFile): StreamableFile {
    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    return new StreamableFile(file.content);
  }
}
