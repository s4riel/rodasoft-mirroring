import { Module } from '@nestjs/common';
import { SalesModule } from '../sales/sales.module';
import { InvoiceCancellationsService } from './invoice-cancellations.service';
import { InvoiceDocumentsService } from './invoice-documents.service';
import { InvoiceIssuingService } from './invoice-issuing.service';
import { InvoiceNitExceptionService } from './invoice-nit-exception.service';
import { InvoicePdfService } from './invoice-pdf.service';
import { InvoiceQueriesService } from './invoice-queries.service';
import { InvoicingController } from './invoicing.controller';

/**
 * SIAT invoicing (HU-FAC-01…10). A completed sale already leaves an `Invoice` in `PENDING`; this module lists, shows and issues
 * it by hand (the worker makes the attempt). There is no contingency. Delivery, PDF/XML, the NIT exception and the cancellation
 * review are added by the next slices of the same plan.
 */
@Module({
  imports: [SalesModule],
  controllers: [InvoicingController],
  providers: [InvoiceQueriesService, InvoiceIssuingService, InvoiceDocumentsService, InvoicePdfService, InvoiceNitExceptionService, InvoiceCancellationsService],
})
export class InvoicingModule {}
