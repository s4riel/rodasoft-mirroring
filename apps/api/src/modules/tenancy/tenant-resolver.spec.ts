import { resolveEmpresaSlug } from './tenant-resolver';

describe('resolveEmpresaSlug', () => {
  it('prefiere el encabezado X-Empresa', () => {
    expect(resolveEmpresaSlug({ headers: { 'x-empresa': 'empresa2', host: 'rodalaser.localhost:4200' } })).toBe('empresa2');
  });
  it('usa el subdominio del host', () => {
    expect(resolveEmpresaSlug({ headers: { host: 'rodalaser.erp.rodalaser.com.bo' } })).toBe('rodalaser');
    expect(resolveEmpresaSlug({ headers: { 'x-forwarded-host': 'empresa2.localhost:4200', host: 'localhost:3000' } })).toBe('empresa2');
  });
  it('acepta ?empresa= como último recurso', () => {
    expect(resolveEmpresaSlug({ headers: { host: 'localhost:3000' }, query: { empresa: 'rodalaser' } })).toBe('rodalaser');
  });
  it('ignora valores inválidos', () => {
    expect(resolveEmpresaSlug({ headers: { 'x-empresa': '../etc', host: 'localhost' } })).toBeNull();
  });
});
