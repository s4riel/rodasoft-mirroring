import { formatXmlDate } from './cuf';
import type { InvoiceCustomer } from './gateway';
import { escapeXml } from './invoice-xml';
import { type DigitalSignature, signXml } from './xml-signer';

export interface CreditNoteXmlLine {
  code: string;
  description: string;
  /** Pieces credited; 0 for a price adjustment. */
  quantity: number;
  /** Decimal strings, 2 places. */
  unitPrice: string;
  amount: string;
}

export interface CreditNoteXmlInput {
  issuerNit: string;
  issuerName: string;
  branchCode: number;
  pointOfSaleCode: number;
  cuf: string;
  number: number;
  issuedAt: Date;
  customer: InvoiceCustomer;
  /** The invoice the note corrects. */
  invoiceNumber: number;
  invoiceCuf: string;
  invoiceIssuedAt: Date;
  invoiceTotal: string;
  reasonCode: number;
  /** What the note credits and the fiscal debit it takes back. */
  total: string;
  vatAdjusted: string;
  lines: readonly CreditNoteXmlLine[];
  legend: string;
}

/**
 * Provisional XML of a credit and debit note (sector 24). Like the invoice XML, the tags follow the shape of the SIN
 * specification but have NOT been validated against the official XSD: the real document arrives with HU-FAC-22…26.
 */
export function buildCreditNoteXml(input: CreditNoteXmlInput): string {
  const detail = input.lines
    .map(
      (line) =>
        `  <detalle><codigoProducto>${escapeXml(line.code)}</codigoProducto><descripcion>${escapeXml(line.description)}</descripcion>` +
        `<cantidad>${line.quantity}</cantidad><precioUnitario>${line.unitPrice}</precioUnitario><subTotal>${line.amount}</subTotal>` +
        '<codigoDetalleTransaccion>2</codigoDetalleTransaccion></detalle>',
    )
    .join('\n');
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!-- PROVISIONAL: not validated against the official SIN schema -->',
    '<notaFiscalElectronicaCreditoDebito>',
    '  <cabecera>',
    `    <nitEmisor>${escapeXml(input.issuerNit)}</nitEmisor>`,
    `    <razonSocialEmisor>${escapeXml(input.issuerName)}</razonSocialEmisor>`,
    `    <numeroNotaCreditoDebito>${input.number}</numeroNotaCreditoDebito>`,
    `    <cuf>${escapeXml(input.cuf)}</cuf>`,
    `    <codigoSucursal>${input.branchCode}</codigoSucursal>`,
    `    <codigoPuntoVenta>${input.pointOfSaleCode}</codigoPuntoVenta>`,
    `    <fechaEmision>${formatXmlDate(input.issuedAt)}</fechaEmision>`,
    `    <nombreRazonSocial>${escapeXml(input.customer.name)}</nombreRazonSocial>`,
    `    <codigoTipoDocumentoIdentidad>${input.customer.documentType}</codigoTipoDocumentoIdentidad>`,
    `    <numeroDocumento>${escapeXml(input.customer.documentNumber)}</numeroDocumento>`,
    input.customer.complement ? `    <complemento>${escapeXml(input.customer.complement)}</complemento>` : '',
    `    <numeroFactura>${input.invoiceNumber}</numeroFactura>`,
    `    <numeroAutorizacionCuf>${escapeXml(input.invoiceCuf)}</numeroAutorizacionCuf>`,
    `    <fechaEmisionFactura>${formatXmlDate(input.invoiceIssuedAt)}</fechaEmisionFactura>`,
    `    <montoTotalOriginal>${input.invoiceTotal}</montoTotalOriginal>`,
    `    <montoTotalDevuelto>${input.total}</montoTotalDevuelto>`,
    `    <montoEfectivoCreditoDebito>${input.vatAdjusted}</montoEfectivoCreditoDebito>`,
    `    <codigoMotivo>${input.reasonCode}</codigoMotivo>`,
    `    <leyenda>${escapeXml(input.legend)}</leyenda>`,
    '  </cabecera>',
    detail,
    '</notaFiscalElectronicaCreditoDebito>',
  ]
    .filter((row) => row !== '')
    .join('\n');
}

/** The note XML signed with the company's digital signature, or unsigned when it has none yet. */
export function buildSignedCreditNoteXml(input: CreditNoteXmlInput, signature: DigitalSignature | null): string {
  const xml = buildCreditNoteXml(input);
  return signature ? signXml(xml, signature) : xml;
}
