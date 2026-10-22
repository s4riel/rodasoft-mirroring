import { resolveCompanySlug } from './tenant-resolver';

describe('resolveCompanySlug', () => {
  it('prefers the X-Company header', () => {
    expect(resolveCompanySlug({ headers: { 'x-company': 'company2', host: 'rodalaser.localhost:4200' } })).toBe('company2');
  });
  it('uses the host subdomain', () => {
    expect(resolveCompanySlug({ headers: { host: 'rodalaser.erp.rodalaser.com.bo' } })).toBe('rodalaser');
    expect(resolveCompanySlug({ headers: { 'x-forwarded-host': 'company2.localhost:4200', host: 'localhost:3000' } })).toBe('company2');
  });
  it('accepts ?company= as a last resort', () => {
    expect(resolveCompanySlug({ headers: { host: 'localhost:3000' }, query: { company: 'rodalaser' } })).toBe('rodalaser');
  });
  it('ignores invalid values', () => {
    expect(resolveCompanySlug({ headers: { 'x-company': '../etc', host: 'localhost' } })).toBeNull();
  });
});
