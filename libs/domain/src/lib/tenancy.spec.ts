import { companySlugFromHost } from './tenancy';

describe('companySlugFromHost', () => {
  it.each([
    ['rodalaser.localhost:4200', 'rodalaser'],
    ['company2.erp.rodalaser.com.bo', 'company2'],
    ['localhost:4200', null],
    ['127.0.0.1', null],
    ['www.rodalaser.com.bo', null],
    ['api.rodalaser.com.bo', null],
    ['Bad_Slug.localhost', null],
  ])('%s -> %s', (host, slug) => {
    expect(companySlugFromHost(host)).toBe(slug);
  });
});
