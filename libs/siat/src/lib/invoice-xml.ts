import { formatXmlDate } from './cuf';
import type { InvoiceCustomer } from './gateway';
import { type DigitalSignature, signXml } from './xml-signer';

export interface InvoiceXmlLine {
  code: string;
  description: string;
  quantity: number;
  /** Decimal strings, 2 places. */
  unitPrice: string;
  subtotal: string;
}

export interface InvoiceXmlInput {
  issuerNit: string;
  issuerName: string;
  branchCode: number;
  pointOfSaleCode: number;
  cuf: string;
  number: number;
  issuedAt: Date;
  customer: InvoiceCustomer;
  total: string;
  lines: readonly InvoiceXmlLine[];
  legend: string;
}

const escapeXml = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

/**
 * Provisional XML of a purchase-sale invoice (sector 1). The tags follow the shape of the SIN specification but have NOT been
 * validated against the official XSD: the real document arrives with HU-FAC-22…26. The comment on top says so.
 */
export function buildInvoiceXml(input: InvoiceXmlInput): string {
  const detail = input.lines
    .map(
      (line) =>
        `  <detalle><codigoProducto>${escapeXml(line.code)}</codigoProducto><descripcion>${escapeXml(line.description)}</descripcion>` +
        `<cantidad>${line.quantity}</cantidad><precioUnitario>${line.unitPrice}</precioUnitario><subTotal>${line.subtotal}</subTotal></detalle>`,
    )
    .join('\n');
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!-- PROVISIONAL: not validated against the official SIN schema -->',
    '<facturaElectronicaCompraVenta>',
    '  <cabecera>',
    `    <nitEmisor>${escapeXml(input.issuerNit)}</nitEmisor>`,
    `    <razonSocialEmisor>${escapeXml(input.issuerName)}</razonSocialEmisor>`,
    `    <numeroFactura>${input.number}</numeroFactura>`,
    `    <cuf>${escapeXml(input.cuf)}</cuf>`,
    `    <codigoSucursal>${input.branchCode}</codigoSucursal>`,
    `    <codigoPuntoVenta>${input.pointOfSaleCode}</codigoPuntoVenta>`,
    `    <fechaEmision>${formatXmlDate(input.issuedAt)}</fechaEmision>`,
    `    <nombreRazonSocial>${escapeXml(input.customer.name)}</nombreRazonSocial>`,
    `    <codigoTipoDocumentoIdentidad>${input.customer.documentType}</codigoTipoDocumentoIdentidad>`,
    `    <numeroDocumento>${escapeXml(input.customer.documentNumber)}</numeroDocumento>`,
    input.customer.complement ? `    <complemento>${escapeXml(input.customer.complement)}</complemento>` : '',
    `    <montoTotal>${input.total}</montoTotal>`,
    `    <leyenda>${escapeXml(input.legend)}</leyenda>`,
    '  </cabecera>',
    detail,
    '</facturaElectronicaCompraVenta>',
  ]
    .filter((row) => row !== '')
    .join('\n');
}

/** The invoice XML signed with the company's digital signature, or unsigned when it has none yet. */
export function buildSignedInvoiceXml(input: InvoiceXmlInput, signature: DigitalSignature | null): string {
  const xml = buildInvoiceXml(input);
  return signature ? signXml(xml, signature) : xml;
}
