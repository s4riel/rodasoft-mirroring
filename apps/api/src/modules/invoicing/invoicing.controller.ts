import { BadRequestException, Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query, Res, StreamableFile, UploadedFile, UseInterceptors, ValidationError, ValidationPipe } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import type {
  CatalogEntriesResponse,
  CatalogSummary,
  CreditableInvoice,
  CreditNoteDetail,
  CreditNoteListResponse,
  FiscalSettingsSummary,
  HomologationImportPreview,
  HomologationImportResult,
  HomologationResponse,
  HomologationRow,
  InvoiceBulkResult,
  InvoiceCancellationsResponse,
  InvoiceDetail,
  InvoiceListResponse,
  InvoicingStatus,
  PointOfSaleListItem,
  PointOfSaleListResponse,
  PurchasesBookResponse,
  SalesBookResponse,
  SiatConnectionStatus,
  SiatPointOfSaleStatus,
  SiatSystemStatus,
  VatPeriodBlockers,
  VatPeriodRow,
  VatPeriodsResponse,
} from '@rodasoft/domain';
import { RequirePermissions } from '../access/require-permissions.decorator';
import type { ListUploadFile } from '../inventory/list-file';
import { UploadLimitInterceptor } from '../inventory/uploads.controller';
import { FiscalSettingsService, SIGNATURE_MAX_BYTES, type SignatureUpload } from './fiscal-settings.service';
import { HomologationService } from './homologation.service';
import { PointsOfSaleService } from './points-of-sale.service';
import { SiatCatalogsService, type SiatReason } from './siat-catalogs.service';
import { CreditNoteQueriesService } from './credit-note-queries.service';
import { CreditNotesService } from './credit-notes.service';
import { InvoiceCancellationsService } from './invoice-cancellations.service';
import { InvoiceDocumentsService, type InvoiceFile } from './invoice-documents.service';
import { InvoiceIssuingService } from './invoice-issuing.service';
import { InvoiceNitExceptionService } from './invoice-nit-exception.service';
import { InvoiceQueriesService } from './invoice-queries.service';
import {
  CatalogEntriesQueryDto,
  CreateCreditNoteDto,
  CreatePointOfSaleDto,
  DeliverInvoiceDto,
  DownloadInvoicesDto,
  EnableProductionDto,
  HomologateProductDto,
  HomologationQueryDto,
  InvoiceCancellationRequestDto,
  IssueInvoicesDto,
  ListCreditNotesQueryDto,
  ListInvoicesQueryDto,
  NitExceptionDecisionDto,
  NitExceptionRequestDto,
  ReopenVatPeriodDto,
  SaveActivityDto,
  SaveCredentialsDto,
  SaveSignatureDto,
  UpdateInvoiceCustomerDto,
  VatBookExportQueryDto,
  VatBookQueryDto,
  VerifyPurchaseNitDto,
} from './invoicing.dto';
import { invoicingErrors } from './invoicing.errors';
import { SiatSystemStatusService } from './siat-system-status.service';
import { VatBookExportService } from './vat-book-export.service';
import { type PurchaseNitVerification, VatBooksService } from './vat-books.service';
import { VatPeriodsService } from './vat-periods.service';

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
const noteIdPipe = new ParseUUIDPipe({ exceptionFactory: () => invoicingErrors.noteNotFound() });
const pointOfSaleIdPipe = new ParseUUIDPipe({ exceptionFactory: () => invoicingErrors.pointOfSaleNotFound() });
const purchaseEntryIdPipe = new ParseUUIDPipe({ exceptionFactory: () => invoicingErrors.purchaseEntryNotFound() });
const productIdPipe = new ParseUUIDPipe({ exceptionFactory: () => invoicingErrors.productNotFound() });
/** Largest homologation file: 2 000 rows of three short cells fit in a fraction of it. */
const IMPORT_FILE_MAX_BYTES = 2 * 1024 * 1024;

const requireFile = (file: ListUploadFile | undefined): ListUploadFile => {
  if (!file) throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'Invalid request', details: [{ field: 'file', code: 'FILE_REQUIRED' }] });
  return file;
};

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
    private readonly noteQueries: CreditNoteQueriesService,
    private readonly notes: CreditNotesService,
    private readonly systemStatus: SiatSystemStatusService,
    private readonly vatBooks: VatBooksService,
    private readonly vatBookExport: VatBookExportService,
    private readonly vatPeriods: VatPeriodsService,
    private readonly fiscal: FiscalSettingsService,
    private readonly pointsOfSale: PointsOfSaleService,
    private readonly catalogs: SiatCatalogsService,
    private readonly homologation: HomologationService,
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

  // ── Credit and debit notes (HU-FAC-11, HU-FAC-12) ──

  @Get('notes')
  @RequirePermissions('invoicing.invoices.view')
  listNotes(@Query(validation) query: ListCreditNotesQueryDto): Promise<CreditNoteListResponse> {
    return this.noteQueries.list(query);
  }

  @Get('notes/:id')
  @RequirePermissions('invoicing.invoices.view')
  noteDetail(@Param('id', noteIdPipe) id: string): Promise<CreditNoteDetail> {
    return this.noteQueries.detail(id);
  }

  /** What is still creditable of an invoice, for the price-adjustment form. */
  @Get('invoices/:id/creditable')
  @RequirePermissions('invoicing.notes.issue')
  creditable(@Param('id', invoiceIdPipe) id: string): Promise<CreditableInvoice> {
    return this.noteQueries.creditable(id);
  }

  /** A price-adjustment note, without a return; only when the company allows it (`invoicing.allowPriceAdjustmentNotes`). */
  @Post('invoices/:id/credit-notes')
  @RequirePermissions('invoicing.notes.issue')
  createNote(@Param('id', invoiceIdPipe) id: string, @Body(validation) dto: CreateCreditNoteDto): Promise<{ id: string }> {
    return this.notes.createPriceAdjustment(id, dto);
  }

  @Post('notes/:id/issue')
  @HttpCode(204)
  @RequirePermissions('invoicing.notes.issue')
  issueNote(@Param('id', noteIdPipe) id: string): Promise<void> {
    return this.notes.issue(id);
  }

  /** Gives up a note the SIAT never validated. */
  @Post('notes/:id/void')
  @HttpCode(204)
  @RequirePermissions('invoicing.notes.issue')
  voidNote(@Param('id', noteIdPipe) id: string): Promise<void> {
    return this.notes.voidNote(id);
  }

  @Get('notes/:id/pdf')
  @RequirePermissions('invoicing.invoices.view')
  async notePdf(@Param('id', noteIdPipe) id: string, @Res({ passthrough: true }) res: Response): Promise<StreamableFile> {
    return this.file(res, await this.noteQueries.pdfOf(id));
  }

  @Get('notes/:id/xml')
  @RequirePermissions('invoicing.invoices.view')
  async noteXml(@Param('id', noteIdPipe) id: string, @Res({ passthrough: true }) res: Response): Promise<StreamableFile> {
    return this.file(res, await this.noteQueries.xmlOf(id));
  }

  // ── SIAT system status (HU-FAC-13) ──

  @Get('system-status')
  @RequirePermissions('invoicing.invoices.view')
  siatSystemStatus(): Promise<SiatSystemStatus> {
    return this.systemStatus.status();
  }

  @Post('points-of-sale/:id/renew-cufd')
  @HttpCode(200)
  @RequirePermissions('invoicing.settings.manage')
  renewCufd(@Param('id', pointOfSaleIdPipe) id: string): Promise<SiatPointOfSaleStatus> {
    return this.systemStatus.renewCufd(id);
  }

  @Post('test-connection')
  @HttpCode(200)
  @RequirePermissions('invoicing.settings.manage')
  testConnection(): Promise<{ connection: SiatConnectionStatus; checkedAt: string }> {
    return this.systemStatus.testConnection();
  }

  // ── VAT books (HU-FAC-18, HU-FAC-19, HU-FAC-20) ──

  @Get('vat-books/sales')
  @RequirePermissions('invoicing.vat-books.view')
  salesBook(@Query(validation) query: VatBookQueryDto): Promise<SalesBookResponse> {
    return this.vatBooks.sales(query);
  }

  @Get('vat-books/purchases')
  @RequirePermissions('invoicing.vat-books.view')
  purchasesBook(@Query(validation) query: VatBookQueryDto): Promise<PurchasesBookResponse> {
    return this.vatBooks.purchases(query);
  }

  @Post('vat-books/purchases/:id/verify-nit')
  @HttpCode(200)
  @RequirePermissions('invoicing.vat-books.view')
  verifyPurchaseNit(@Param('id', purchaseEntryIdPipe) id: string, @Body(validation) dto: VerifyPurchaseNitDto): Promise<PurchaseNitVerification> {
    return this.vatBooks.verifyPurchaseNit(id, dto);
  }

  /** The book as a file; `X-Vat-Book-Draft` says whether the period is still open. */
  @Get('vat-books/export')
  @RequirePermissions('invoicing.vat-books.view')
  async exportBook(@Query(validation) query: VatBookExportQueryDto, @Res({ passthrough: true }) res: Response): Promise<StreamableFile> {
    const file = await this.vatBookExport.export(query);
    res.setHeader('X-Vat-Book-Draft', String(file.draft));
    res.setHeader('Access-Control-Expose-Headers', 'X-Vat-Book-Draft, Content-Disposition');
    return this.file(res, file);
  }

  // ── Closing VAT periods (HU-FAC-21) ──

  @Get('vat-periods')
  @RequirePermissions('invoicing.vat-books.view')
  periods(): Promise<VatPeriodsResponse> {
    return this.vatPeriods.list();
  }

  @Get('vat-periods/:period/blockers')
  @RequirePermissions('invoicing.vat-books.view')
  periodBlockers(@Param('period') period: string): Promise<VatPeriodBlockers> {
    return this.vatPeriods.blockers(period);
  }

  @Post('vat-periods/:period/close')
  @HttpCode(200)
  @RequirePermissions('invoicing.vat-books.close')
  closePeriod(@Param('period') period: string): Promise<VatPeriodRow> {
    return this.vatPeriods.close(period);
  }

  @Post('vat-periods/:period/file')
  @HttpCode(200)
  @RequirePermissions('invoicing.vat-books.close')
  filePeriod(@Param('period') period: string): Promise<VatPeriodRow> {
    return this.vatPeriods.file(period);
  }

  @Post('vat-periods/:period/reopen')
  @HttpCode(200)
  @RequirePermissions('invoicing.vat-books.close')
  reopenPeriod(@Param('period') period: string, @Body(validation) dto: ReopenVatPeriodDto): Promise<VatPeriodRow> {
    return this.vatPeriods.reopen(period, dto.reason);
  }

  // ── Fiscal configuration (HU-FAC-22…27) ──

  @Get('fiscal-settings')
  @RequirePermissions('invoicing.settings.manage')
  fiscalSettings(): Promise<FiscalSettingsSummary> {
    return this.fiscal.summary();
  }

  /** The digital signature: a `.p12` file and its password, read and stored encrypted. */
  @Put('fiscal-settings/signature')
  @ApiConsumes('multipart/form-data')
  @RequirePermissions('invoicing.settings.manage')
  @UseInterceptors(UploadLimitInterceptor, FileInterceptor('file', { limits: { fileSize: SIGNATURE_MAX_BYTES, files: 1 } }))
  saveSignature(@UploadedFile() file: SignatureUpload | undefined, @Body(validation) dto: SaveSignatureDto): Promise<FiscalSettingsSummary['signature']> {
    if (!file) throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'Invalid request', details: [{ field: 'file', code: 'FILE_REQUIRED' }] });
    return this.fiscal.saveSignature(file, dto.password);
  }

  @Put('fiscal-settings/credentials')
  @RequirePermissions('invoicing.settings.manage')
  saveCredentials(@Body(validation) dto: SaveCredentialsDto): Promise<FiscalSettingsSummary['credentials']> {
    return this.fiscal.saveCredentials(dto);
  }

  @Put('fiscal-settings/activity')
  @RequirePermissions('invoicing.settings.manage')
  saveActivity(@Body(validation) dto: SaveActivityDto): Promise<FiscalSettingsSummary['activity']> {
    return this.fiscal.saveActivity(dto);
  }

  @Post('fiscal-settings/production')
  @HttpCode(200)
  @RequirePermissions('invoicing.production.enable')
  enableProduction(@Body(validation) dto: EnableProductionDto): Promise<{ environment: 'PRODUCTION'; productionEnabledAt: string }> {
    return this.fiscal.enableProduction(dto.confirmation);
  }

  @Get('points-of-sale')
  @RequirePermissions('invoicing.settings.manage')
  listPointsOfSale(): Promise<PointOfSaleListResponse> {
    return this.pointsOfSale.list();
  }

  @Post('points-of-sale')
  @RequirePermissions('invoicing.settings.manage')
  createPointOfSale(@Body(validation) dto: CreatePointOfSaleDto): Promise<PointOfSaleListItem> {
    return this.pointsOfSale.create(dto);
  }

  @Post('points-of-sale/:id/deactivate')
  @HttpCode(200)
  @RequirePermissions('invoicing.settings.manage')
  deactivatePointOfSale(@Param('id', pointOfSaleIdPipe) id: string): Promise<PointOfSaleListItem> {
    return this.pointsOfSale.deactivate(id);
  }

  @Get('catalogs')
  @RequirePermissions('invoicing.invoices.view')
  catalogSummary(): Promise<CatalogSummary> {
    return this.catalogs.summary();
  }

  @Post('catalogs/sync')
  @HttpCode(200)
  @RequirePermissions('invoicing.settings.manage')
  syncCatalogs(): Promise<CatalogSummary> {
    return this.catalogs.sync();
  }

  @Get('catalogs/:catalog')
  @RequirePermissions('invoicing.invoices.view')
  catalogEntries(@Param('catalog') catalog: string, @Query(validation) query: CatalogEntriesQueryDto): Promise<CatalogEntriesResponse> {
    return this.catalogs.entries(catalog, query);
  }

  /** The reasons the cancellation and credit-note dialogs offer. */
  @Get('reasons')
  @RequirePermissions('invoicing.invoices.view')
  reasons(): Promise<{ cancellation: SiatReason[]; creditNote: SiatReason[] }> {
    return this.catalogs.reasons();
  }

  @Get('homologation')
  @RequirePermissions('invoicing.settings.manage')
  homologationList(@Query(validation) query: HomologationQueryDto): Promise<HomologationResponse> {
    return this.homologation.list(query);
  }

  @Get('homologation/template')
  @RequirePermissions('invoicing.settings.manage')
  async homologationTemplate(@Res({ passthrough: true }) res: Response): Promise<StreamableFile> {
    return this.file(res, {
      content: await this.homologation.template(),
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      filename: 'plantilla-homologacion.xlsx',
    });
  }

  @Put('homologation/products/:id')
  @RequirePermissions('invoicing.settings.manage')
  homologateProduct(@Param('id', productIdPipe) id: string, @Body(validation) dto: HomologateProductDto): Promise<HomologationRow> {
    return this.homologation.update(id, dto);
  }

  @Post('homologation/import/preview')
  @HttpCode(200)
  @ApiConsumes('multipart/form-data')
  @RequirePermissions('invoicing.settings.manage')
  @UseInterceptors(UploadLimitInterceptor, FileInterceptor('file', { limits: { fileSize: IMPORT_FILE_MAX_BYTES, files: 1 } }))
  homologationPreview(@UploadedFile() file: ListUploadFile | undefined): Promise<HomologationImportPreview> {
    return this.homologation.preview(requireFile(file));
  }

  @Post('homologation/import')
  @HttpCode(200)
  @ApiConsumes('multipart/form-data')
  @RequirePermissions('invoicing.settings.manage')
  @UseInterceptors(UploadLimitInterceptor, FileInterceptor('file', { limits: { fileSize: IMPORT_FILE_MAX_BYTES, files: 1 } }))
  homologationImport(@UploadedFile() file: ListUploadFile | undefined): Promise<HomologationImportResult> {
    return this.homologation.apply(requireFile(file));
  }

  private file(res: Response, file: InvoiceFile): StreamableFile {
    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    return new StreamableFile(file.content);
  }
}
