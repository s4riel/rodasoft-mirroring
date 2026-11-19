import { Module } from '@nestjs/common';
import { SalesModule } from '../sales/sales.module';
import { CreditNoteQueriesService } from './credit-note-queries.service';
import { CreditNotesService } from './credit-notes.service';
import { FiscalSettingsService } from './fiscal-settings.service';
import { HomologationService } from './homologation.service';
import { InvoiceCancellationsService } from './invoice-cancellations.service';
import { InvoiceDocumentsService } from './invoice-documents.service';
import { InvoiceIssuingService } from './invoice-issuing.service';
import { InvoiceNitExceptionService } from './invoice-nit-exception.service';
import { InvoicePdfService } from './invoice-pdf.service';
import { InvoiceQueriesService } from './invoice-queries.service';
import { InvoicingController } from './invoicing.controller';
import { PointsOfSaleService } from './points-of-sale.service';
import { SiatCatalogsService } from './siat-catalogs.service';
import { SiatSystemStatusService } from './siat-system-status.service';
import { VatBookExportService } from './vat-book-export.service';
import { VatBooksService } from './vat-books.service';
import { VatPeriodsService } from './vat-periods.service';

/**
 * SIAT invoicing (HU-FAC-01…13, 18…20). A completed sale already leaves an `Invoice` in `PENDING`; this module lists, shows and
 * issues it by hand (the worker makes the attempt). There is no contingency. It also lists and issues the credit notes, shows the
 * health of the SIAT link (CUIS, CUFD, connection) and builds the VAT books and their export.
 */
@Module({
  imports: [SalesModule],
  controllers: [InvoicingController],
  providers: [
    InvoiceQueriesService,
    InvoiceIssuingService,
    InvoiceDocumentsService,
    InvoicePdfService,
    InvoiceNitExceptionService,
    InvoiceCancellationsService,
    CreditNoteQueriesService,
    CreditNotesService,
    SiatSystemStatusService,
    VatBooksService,
    VatBookExportService,
    VatPeriodsService,
    FiscalSettingsService,
    PointsOfSaleService,
    SiatCatalogsService,
    HomologationService,
  ],
})
export class InvoicingModule {}
