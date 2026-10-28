import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { LinkEquivalenceDto } from './product-write.dto';

const A = '0192e0f0-0000-7000-8000-000000000001';
const B = '0192e0f0-0000-7000-8000-000000000002';

const errorsOf = async (body: object) => (await validate(plainToInstance(LinkEquivalenceDto, body), { whitelist: true, forbidNonWhitelisted: true })).map((e) => e.property);

describe('LinkEquivalenceDto', () => {
  it('accepts the two products alone', async () => {
    expect(await errorsOf({ productAId: A, productBId: B })).toEqual([]);
  });

  it('accepts the substitute classification and notes of up to 500 characters', async () => {
    expect(await errorsOf({ productAId: A, productBId: B, substitute: true, notes: 'x'.repeat(500) })).toEqual([]);
  });

  it('refuses notes longer than 500 characters', async () => {
    expect(await errorsOf({ productAId: A, productBId: B, notes: 'x'.repeat(501) })).toEqual(['notes']);
  });

  it('refuses a substitute flag that is not a boolean and notes that are not text', async () => {
    expect((await errorsOf({ productAId: A, productBId: B, substitute: 'yes', notes: 5 })).sort()).toEqual(['notes', 'substitute']);
  });

  it('refuses ids that are not uuids', async () => {
    expect((await errorsOf({ productAId: 'a', productBId: 'b' })).sort()).toEqual(['productAId', 'productBId']);
  });

  it('no longer takes an acknowledgement of incompatible measures', async () => {
    expect(await errorsOf({ productAId: A, productBId: B, acknowledgeIncompatible: true })).toEqual(['acknowledgeIncompatible']);
  });
});
