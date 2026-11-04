import { Decimal, IdentityDocumentType, type CustomerSummary, type DocumentErrorKind } from '@rodasoft/domain';
import type { SelectOption } from '@rodasoft/ui';

/** Short names of the identity document types (the SIN catalog uses the same acronyms). */
export const DOCUMENT_TYPE_LABELS: Readonly<Record<number, string>> = {
  [IdentityDocumentType.CI]: 'CI',
  [IdentityDocumentType.CEX]: 'CEX',
  [IdentityDocumentType.PAS]: 'Pasaporte',
  [IdentityDocumentType.OD]: 'Otro documento',
  [IdentityDocumentType.NIT]: 'NIT',
};

/** NIT first: it is what most customers invoice with. */
export const DOCUMENT_TYPE_OPTIONS: SelectOption<number>[] = [
  IdentityDocumentType.NIT,
  IdentityDocumentType.CI,
  IdentityDocumentType.CEX,
  IdentityDocumentType.PAS,
  IdentityDocumentType.OD,
].map((value) => ({ value, label: DOCUMENT_TYPE_LABELS[value] }));

/** "NIT 1023456027", "CI 4567890-1A". */
export function documentText(c: Pick<CustomerSummary, 'documentType' | 'documentNumber' | 'complement'>): string {
  const label = DOCUMENT_TYPE_LABELS[c.documentType] ?? 'Documento';
  return `${label} ${c.documentNumber}${c.complement ? `-${c.complement}` : ''}`;
}

/** A percent without trailing zeros and with a decimal comma: "10", "12,5". */
function percentText(value: string): string {
  const text = Decimal.of(value).toString().replace(/\.?0+$/, '');
  return text.replace('.', ',');
}

/** "Sin descuento", "10 % de descuento" or "Bs 15,00 de descuento por venta". */
export function discountText(discount: CustomerSummary['discount']): string {
  if (discount.type === 'PERCENT') return `${percentText(discount.value)} % de descuento`;
  if (discount.type === 'AMOUNT') return `${Decimal.of(discount.value).format()} de descuento por venta`;
  return 'Sin descuento';
}

/** Second line of a customer in the POS: "NIT 1023456027 · compras@minerademo.bo · crédito". */
export function customerDetail(c: CustomerSummary): string {
  return [documentText(c), c.email, c.creditEnabled ? 'crédito habilitado' : null, c.discount.type !== 'NONE' ? discountText(c.discount) : null]
    .filter((part): part is string => !!part)
    .join(' · ');
}

/** Spanish message for each reason the document is refused (the server answers `INVALID_NIT` with the same reasons). */
export function documentErrorMessage(type: number, reason: DocumentErrorKind): string {
  if (reason === 'REQUIRED') return 'Ingresa el número de documento.';
  if (reason === 'COMPLEMENT') return 'El complemento es solo para CI, de 1 o 2 caracteres.';
  switch (type) {
    case IdentityDocumentType.NIT:
      return 'NIT inválido: usa de 5 a 13 dígitos.';
    case IdentityDocumentType.CI:
      return 'CI inválido: usa de 5 a 10 dígitos.';
    default:
      return 'El documento no es válido.';
  }
}
