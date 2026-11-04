import type { CustomerSummary } from '@rodasoft/domain';
import { customerDetail, discountText, documentErrorMessage, documentText } from './customer-format';

const base: CustomerSummary = {
  id: 'c1',
  name: 'Minera Demo Ltda.',
  documentType: 5,
  documentNumber: '1023456027',
  complement: null,
  email: 'compras@minerademo.bo',
  phone: null,
  creditEnabled: false,
  discount: { type: 'NONE', value: '0.00' },
  status: 'ACTIVE',
};

describe('customer format', () => {
  it('names the document with its type and complement', () => {
    expect(documentText(base)).toBe('NIT 1023456027');
    expect(documentText({ documentType: 1, documentNumber: '4567890', complement: '1A' })).toBe('CI 4567890-1A');
    expect(documentText({ documentType: 3, documentNumber: 'AB123456', complement: null })).toBe('Pasaporte AB123456');
  });

  it('says the discount in words, with a decimal comma and no trailing zeros', () => {
    expect(discountText({ type: 'NONE', value: '0.00' })).toBe('Sin descuento');
    expect(discountText({ type: 'PERCENT', value: '10.00' })).toBe('10 % de descuento');
    expect(discountText({ type: 'PERCENT', value: '12.50' })).toBe('12,5 % de descuento');
    expect(discountText({ type: 'AMOUNT', value: '15.50' })).toBe('Bs 15,50 de descuento por venta');
  });

  it('builds the second line of a customer in the POS', () => {
    expect(customerDetail(base)).toBe('NIT 1023456027 · compras@minerademo.bo');
    expect(customerDetail({ ...base, email: null, creditEnabled: true, discount: { type: 'PERCENT', value: '10.00' } })).toBe(
      'NIT 1023456027 · crédito habilitado · 10 % de descuento',
    );
  });

  it('explains why a document is refused, by type', () => {
    expect(documentErrorMessage(5, 'FORMAT')).toBe('NIT inválido: usa de 5 a 13 dígitos.');
    expect(documentErrorMessage(1, 'FORMAT')).toBe('CI inválido: usa de 5 a 10 dígitos.');
    expect(documentErrorMessage(3, 'FORMAT')).toBe('El documento no es válido.');
    expect(documentErrorMessage(5, 'REQUIRED')).toBe('Ingresa el número de documento.');
    expect(documentErrorMessage(5, 'COMPLEMENT')).toBe('El complemento es solo para CI, de 1 o 2 caracteres.');
  });
});
