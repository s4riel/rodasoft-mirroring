import { Injectable } from '@nestjs/common';
import { amountInWords, type InvoiceStatus } from '@rodasoft/domain';
import PDFDocument from 'pdfkit';
import qrcode from 'qrcode-generator';

export interface InvoicePdfInput {
  issuerName: string;
  issuerNit: string;
  branchName: string;
  pointOfSale: string | null;
  number: number;
  cuf: string;
  issuedAt: Date;
  status: InvoiceStatus;
  customerName: string;
  /** "NIT 1234567" */
  customerDocument: string;
  lines: readonly { description: string; quantity: number; unitPrice: string; total: string }[];
  total: string;
  legend: string;
  verificationUrl: string;
}

const MARGIN = 40;
const TIME = new Intl.DateTimeFormat('es-BO', { timeZone: 'America/La_Paz', dateStyle: 'short', timeStyle: 'short', hour12: false });
const money = (amount: string): string => Number(amount).toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * The printed invoice (HU-FAC-05): issuer, number, CUF, customer, lines, total in words, legend and the verification QR. Rendered on
 * the server so the preview, the download, the e-mail and the ZIP are the same bytes. It follows the SIN layout only roughly and says
 * "PROVISIONAL" on top: the official layout arrives with HU-FAC-22…26.
 */
@Injectable()
export class InvoicePdfService {
  /** `compress: false` keeps the page streams readable, for the tests. */
  render(input: InvoicePdfInput, options: { compress?: boolean } = {}): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'LETTER', margin: MARGIN, info: { Title: `Factura ${input.number}`, Author: input.issuerName }, compress: options.compress ?? true });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const width = doc.page.width - MARGIN * 2;
      doc.font('Helvetica-Bold').fontSize(9).fillColor('#b45309').text('PROVISIONAL · no es un documento fiscal validado', { align: 'center' });
      doc.moveDown(0.5).fillColor('#000');
      doc.font('Helvetica-Bold').fontSize(18).text('FACTURA', { align: 'center' });
      doc.font('Helvetica').fontSize(9).text('Con derecho a crédito fiscal', { align: 'center' });
      if (input.status === 'CANCELLED') doc.font('Helvetica-Bold').fontSize(14).fillColor('#b91c1c').text('ANULADA', { align: 'center' }).fillColor('#000');
      doc.moveDown();

      const top = doc.y;
      doc.font('Helvetica-Bold').fontSize(11).text(input.issuerName, MARGIN, top, { width: width / 2 });
      doc.font('Helvetica').fontSize(9).text(`NIT: ${input.issuerNit}`, { width: width / 2 });
      doc.text(`Sucursal: ${input.branchName}`, { width: width / 2 });
      if (input.pointOfSale) doc.text(`Punto de venta: ${input.pointOfSale}`, { width: width / 2 });
      doc.font('Helvetica').fontSize(9).text(`Factura N.º: ${String(input.number).padStart(6, '0')}`, MARGIN + width / 2, top, { width: width / 2, align: 'right' });
      doc.text(`Fecha: ${TIME.format(input.issuedAt)}`, { width: width / 2, align: 'right' });
      doc.font('Helvetica-Bold').text('CUF', { width: width / 2, align: 'right' });
      doc.font('Courier').fontSize(7).text(input.cuf, { width: width / 2, align: 'right' });

      doc.y = Math.max(doc.y, top + 70) + 14;
      doc.x = MARGIN;
      doc.font('Helvetica-Bold').fontSize(9).text(`Cliente: ${input.customerName}`, MARGIN, doc.y, { width });
      doc.font('Helvetica').text(input.customerDocument);
      doc.moveDown();

      const columns = { description: MARGIN, quantity: MARGIN + width * 0.55, unitPrice: MARGIN + width * 0.67, total: MARGIN + width * 0.83 };
      const header = doc.y;
      doc.font('Helvetica-Bold').fontSize(9);
      doc.text('Descripción', columns.description, header, { width: width * 0.5 });
      doc.text('Cant.', columns.quantity, header, { width: width * 0.1, align: 'right' });
      doc.text('Precio (Bs)', columns.unitPrice, header, { width: width * 0.14, align: 'right' });
      doc.text('Total (Bs)', columns.total, header, { width: width * 0.17, align: 'right' });
      doc.moveTo(MARGIN, header + 14).lineTo(MARGIN + width, header + 14).strokeColor('#999').stroke();
      doc.y = header + 20;

      doc.font('Helvetica').fontSize(9);
      for (const line of input.lines) {
        if (doc.y > doc.page.height - 200) doc.addPage();
        const rowTop = doc.y;
        doc.text(line.description, columns.description, rowTop, { width: width * 0.5 });
        const rowBottom = doc.y;
        doc.text(String(line.quantity), columns.quantity, rowTop, { width: width * 0.1, align: 'right' });
        doc.text(money(line.unitPrice), columns.unitPrice, rowTop, { width: width * 0.14, align: 'right' });
        doc.text(money(line.total), columns.total, rowTop, { width: width * 0.17, align: 'right' });
        doc.y = Math.max(rowBottom, rowTop + 12) + 4;
      }

      doc.moveTo(MARGIN, doc.y).lineTo(MARGIN + width, doc.y).strokeColor('#999').stroke();
      doc.y += 8;
      doc.font('Helvetica-Bold').fontSize(11).text(`TOTAL Bs ${money(input.total)}`, MARGIN, doc.y, { width, align: 'right' });
      doc.font('Helvetica').fontSize(9).text(`Son: ${amountInWords(input.total)}`, MARGIN, doc.y + 4, { width });
      doc.moveDown(1.5);

      const qrTop = doc.y;
      const qr = qrcode(0, 'M');
      qr.addData(input.verificationUrl);
      qr.make();
      const count = qr.getModuleCount();
      const cell = 96 / count;
      doc.fillColor('#000');
      for (let row = 0; row < count; row++) for (let col = 0; col < count; col++) if (qr.isDark(row, col)) doc.rect(MARGIN + width - 96 + col * cell, qrTop + row * cell, cell, cell).fill();
      doc.fillColor('#000').font('Helvetica').fontSize(8).text(input.legend, MARGIN, qrTop, { width: width - 112 });
      doc.moveDown(0.5).text('Este documento es la representación gráfica de una factura emitida por el SIAT. Verifícala con el código QR.', { width: width - 112 });

      doc.end();
    });
  }
}
