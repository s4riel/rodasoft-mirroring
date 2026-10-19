import { empresaSlugFromHost } from './tenancy';

describe('empresaSlugFromHost', () => {
  it.each([
    ['rodalaser.localhost:4200', 'rodalaser'],
    ['empresa2.erp.rodalaser.com.bo', 'empresa2'],
    ['localhost:4200', null],
    ['127.0.0.1', null],
    ['www.rodalaser.com.bo', null],
    ['api.rodalaser.com.bo', null],
    ['Mal_Slug.localhost', null],
  ])('%s → %s', (host, slug) => {
    expect(empresaSlugFromHost(host)).toBe(slug);
  });
});
