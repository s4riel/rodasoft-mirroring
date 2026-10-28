/**
 * Integration test against the real Postgres (DATABASE_URL) for linking equivalents (HU-INV-13): validation, the
 * refusal of incompatible pairs, substitute and notes, approval, unlinking, the audit trail and the race on a single pair. Creates two throw-away
 * companies and a user, and removes them at the end, so it is safe to run against the dev database.
 */
import { ConflictException, ForbiddenException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaClient } from '@prisma/client';
import { DEFAULT_ROLES, normalizePair } from '@rodasoft/domain';
import { randomUUID } from 'node:crypto';
import { AuditService } from '../../common/audit/audit.service';
import type { PrismaService } from '../../common/prisma/prisma.service';
import { tenantExtension } from '../../common/prisma/tenant.extension';
import { SettingsService } from '../../common/settings/settings.service';
import { PermissionsGuard } from '../access/permissions.guard';
import { EquivalencesController } from './equivalences.controller';
import { EquivalencesService } from './equivalences.service';

const run = randomUUID().slice(0, 8);

let current: string | null = null;
let currentUser: string | null = null;
/** Same shape as PrismaService: the client itself plus a tenant-scoped extension of it. */
class TestPrisma extends PrismaClient {
  readonly tenant = this.$extends(tenantExtension(() => current));
}
const base = new TestPrisma();
const prisma = base as unknown as PrismaService;
const cls = { get: (k: string) => (k === 'companyId' ? current : k === 'userId' ? currentUser : null) } as never;
const service = new EquivalencesService(prisma, cls, new AuditService(prisma, cls), new SettingsService(prisma));

const MEASURES_6205 = { innerDiameter: '25', outerDiameter: '52', width: '15' };
const ATTRS = { seal: '2RS', internalClearance: 'CN', toleranceClass: 'P0', cage: 'Acero', dynamicLoad: 14.8, staticLoad: 7.8 };

interface Fixture {
  companyId: string;
  brands: Record<string, string>;
  balls: string;
  rollers: string;
}

async function createCompany(tag: string): Promise<Fixture> {
  const company = await base.company.create({ data: { slug: `lk-${tag}-${run}`, legalName: tag, tradeName: tag, nit: `${tag}${run}`.slice(0, 20) } });
  const companyId = company.id;
  const brands: Record<string, string> = {};
  for (const name of ['SKF', 'NSK', 'FAG']) brands[name] = (await base.brand.create({ data: { companyId, name } })).id;
  const bearings = await base.category.create({ data: { companyId, name: 'Rodamientos' } });
  const balls = await base.category.create({ data: { companyId, name: 'Bolas', parentId: bearings.id } });
  const rollers = await base.category.create({ data: { companyId, name: 'Rodillos', parentId: bearings.id } });
  await base.attributeDefinition.create({ data: { companyId, categoryId: bearings.id, key: 'seal', label: 'Protección / sello', type: 'ENUM', step: 3 } });
  return { companyId, brands, balls: balls.id, rollers: rollers.id };
}

async function removeCompany(companyId: string) {
  await base.equivalence.deleteMany({ where: { companyId } });
  await base.auditLog.deleteMany({ where: { companyId } });
  await base.companySetting.deleteMany({ where: { companyId } });
  await base.productDimension.deleteMany({ where: { companyId } });
  await base.product.deleteMany({ where: { companyId } });
  await base.attributeDefinition.deleteMany({ where: { companyId } });
  await base.category.deleteMany({ where: { companyId, parentId: { not: null } } });
  await base.category.deleteMany({ where: { companyId } });
  await base.brand.deleteMany({ where: { companyId } });
  await base.company.delete({ where: { id: companyId } });
}

describe('Equivalence linking (integration, real Postgres)', () => {
  let a: Fixture;
  let b: Fixture;
  let userId: string;
  let n = 0;

  const product = async (
    f: Fixture,
    brand: string,
    code: string,
    over: { attributes?: object; dimensions?: object; categoryId?: string } = {},
  ) => {
    n += 1;
    const p = await base.product.create({
      data: {
        companyId: f.companyId,
        sku: `LK-${run}-${n}`,
        manufacturerCode: code,
        brandId: f.brands[brand],
        categoryId: over.categoryId ?? f.balls,
        name: `Rodamiento ${code}`,
        salePrice: '100.00',
        attributes: over.attributes ?? ATTRS,
        dimensions: { create: { companyId: f.companyId, ...(over.dimensions ?? MEASURES_6205) } },
      },
    });
    return p.id;
  };

  const setApproval = (companyId: string, value: boolean) =>
    base.companySetting.upsert({
      where: { companyId_key: { companyId, key: 'inventory.equivalences.requireApproval' } },
      create: { companyId, key: 'inventory.equivalences.requireApproval', value },
      update: { value },
    });

  const audits = (action: string) => base.auditLog.findMany({ where: { companyId: a.companyId, action }, orderBy: { id: 'asc' } });
  const rowsOf = (x: string, y: string) => {
    const [productAId, productBId] = normalizePair(x, y);
    return base.equivalence.findMany({ where: { companyId: a.companyId, productAId, productBId } });
  };

  let skf: string;
  let nsk: string;
  let fag: string;
  let diffSeal: string;
  let bigger: string;
  let roller: string;
  let foreign: string;

  beforeAll(async () => {
    a = await createCompany('a');
    b = await createCompany('b');
    userId = (await base.user.create({ data: { email: `lk-${run}@example.com`, name: 'Linker' } })).id;
    skf = await product(a, 'SKF', '6205-2RS');
    nsk = await product(a, 'NSK', '6205-DDU');
    fag = await product(a, 'FAG', '6205-2RSR');
    diffSeal = await product(a, 'FAG', '6205-2Z', { attributes: { ...ATTRS, seal: '2Z' } });
    bigger = await product(a, 'NSK', '6305-2RS', { dimensions: { innerDiameter: '25', outerDiameter: '62', width: '17' } });
    roller = await product(a, 'FAG', 'NU205', { categoryId: a.rollers });
    foreign = await product(b, 'SKF', 'FOREIGN');
  }, 60_000);

  afterAll(async () => {
    await removeCompany(a.companyId);
    await removeCompany(b.companyId);
    await base.user.delete({ where: { id: userId } });
    await base.$disconnect();
  }, 60_000);

  beforeEach(async () => {
    current = a.companyId;
    currentUser = userId;
    await base.equivalence.deleteMany({ where: { companyId: a.companyId } });
    await base.auditLog.deleteMany({ where: { companyId: a.companyId } });
    await setApproval(a.companyId, false);
  });

  describe('validate', () => {
    it('reports an exact pair as compatible and not linked', async () => {
      expect(await service.validate({ productAId: skf, productBId: fag })).toEqual({
        selfLink: false,
        exists: false,
        equivalenceId: null,
        typeDiffers: false,
        kind: 'EXACT',
        measureDifferences: [],
        differences: [],
      });
    });

    it('lists the specification that differs with the label of the category field', async () => {
      const res = await service.validate({ productAId: skf, productBId: diffSeal });
      expect(res).toMatchObject({ kind: 'WITH_DIFFERENCES', typeDiffers: false });
      expect(res.differences).toEqual([{ key: 'seal', label: 'Protección / sello', source: '2RS', other: '2Z' }]);
    });

    it('reports the measures that differ as incompatible', async () => {
      const res = await service.validate({ productAId: skf, productBId: bigger });
      expect(res).toMatchObject({ kind: 'INCOMPATIBLE', typeDiffers: true });
      expect(res.measureDifferences).toEqual([
        { key: 'D', a: '52', b: '62' },
        { key: 'B', a: '15', b: '17' },
      ]);
    });

    it('reports a different type as incompatible even with the same measures', async () => {
      const res = await service.validate({ productAId: skf, productBId: roller });
      expect(res).toMatchObject({ kind: 'INCOMPATIBLE', typeDiffers: true, measureDifferences: [] });
    });

    it('finds the existing link whichever order the pair is asked in', async () => {
      const created = await service.link({ productAId: skf, productBId: nsk });
      expect(await service.validate({ productAId: skf, productBId: nsk })).toMatchObject({ exists: true, equivalenceId: created.id });
      expect(await service.validate({ productAId: nsk, productBId: skf })).toMatchObject({ exists: true, equivalenceId: created.id });
    });

    it('reports a self-link instead of failing', async () => {
      expect(await service.validate({ productAId: skf, productBId: skf })).toMatchObject({ selfLink: true, exists: false });
    });

    it('answers 404 PRODUCT_NOT_FOUND for a missing product and for one of another company', async () => {
      await expect(service.validate({ productAId: skf, productBId: randomUUID() })).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.validate({ productAId: skf, productBId: foreign })).rejects.toMatchObject({ response: { code: 'PRODUCT_NOT_FOUND' } });
    });

    it('writes nothing', async () => {
      await service.validate({ productAId: skf, productBId: fag });
      expect(await base.equivalence.count({ where: { companyId: a.companyId } })).toBe(0);
      expect(await audits('inventory.equivalence.link')).toHaveLength(0);
    });
  });

  describe('link', () => {
    it('links a compatible pair, approved by whoever linked it when approval is not required, and audits it', async () => {
      const created = await service.link({ productAId: skf, productBId: fag });
      const row = await base.equivalence.findUniqueOrThrow({ where: { id: created.id } });
      expect(row).toMatchObject({ createdById: userId, approvedById: userId, substitute: false, notes: null });
      expect(row.approvedAt).not.toBeNull();
      const [entry] = await audits('inventory.equivalence.link');
      expect(entry).toMatchObject({ entity: 'Equivalence', entityId: created.id, userId });
      expect(entry.after).toMatchObject({ substitute: false, notes: null, approved: true });
    });

    it('stores the pair in canonical order, so linking in either direction is the same row', async () => {
      await service.link({ productAId: fag, productBId: skf });
      await expect(service.link({ productAId: skf, productBId: fag })).rejects.toMatchObject({ response: { code: 'EQUIVALENCE_EXISTS' } });
      const rows = await rowsOf(skf, fag);
      expect(rows).toHaveLength(1);
      expect([rows[0].productAId, rows[0].productBId]).toEqual(normalizePair(skf, fag));
    });

    it('answers 409 EQUIVALENCE_EXISTS with the id of the link that exists, and keeps one row', async () => {
      const created = await service.link({ productAId: skf, productBId: fag });
      const err = await service.link({ productAId: fag, productBId: skf }).catch((e) => e);
      expect(err).toBeInstanceOf(ConflictException);
      expect(err.getResponse()).toMatchObject({ code: 'EQUIVALENCE_EXISTS', details: { equivalenceId: created.id } });
      expect(await rowsOf(skf, fag)).toHaveLength(1);
    });

    it('answers 422 SELF_LINK', async () => {
      await expect(service.link({ productAId: skf, productBId: skf })).rejects.toMatchObject({ response: { code: 'SELF_LINK' } });
    });

    it('answers 404 PRODUCT_NOT_FOUND for a product of another company', async () => {
      await expect(service.link({ productAId: skf, productBId: foreign })).rejects.toMatchObject({ response: { code: 'PRODUCT_NOT_FOUND' } });
      expect(await base.equivalence.count({ where: { companyId: a.companyId } })).toBe(0);
    });

    it('refuses an incompatible pair with 422 EQUIVALENCE_INCOMPATIBLE and the measures that differ', async () => {
      const err = await service.link({ productAId: skf, productBId: bigger }).catch((e) => e);
      expect(err).toBeInstanceOf(UnprocessableEntityException);
      expect(err.getResponse()).toMatchObject({
        code: 'EQUIVALENCE_INCOMPATIBLE',
        details: { typeDiffers: true, measureDifferences: [{ key: 'D', a: '52', b: '62' }, { key: 'B', a: '15', b: '17' }] },
      });
      expect(await rowsOf(skf, bigger)).toHaveLength(0);
      expect(await audits('inventory.equivalence.link')).toHaveLength(0);
    });

    it('refuses a pair of different types even when the measures match', async () => {
      await expect(service.link({ productAId: skf, productBId: roller })).rejects.toMatchObject({ response: { code: 'EQUIVALENCE_INCOMPATIBLE' } });
      expect(await rowsOf(skf, roller)).toHaveLength(0);
    });

    it('refuses an incompatible pair even when it is classified as a substitute', async () => {
      await expect(service.link({ productAId: skf, productBId: bigger, substitute: true })).rejects.toMatchObject({
        response: { code: 'EQUIVALENCE_INCOMPATIBLE' },
      });
      expect(await rowsOf(skf, bigger)).toHaveLength(0);
    });

    it('saves the substitute classification and the observed differences, trimmed, and audits them', async () => {
      const created = await service.link({ productAId: skf, productBId: diffSeal, substitute: true, notes: '  Sello metálico en lugar de contacto.  ' });
      expect(await base.equivalence.findUniqueOrThrow({ where: { id: created.id } })).toMatchObject({
        substitute: true,
        notes: 'Sello metálico en lugar de contacto.',
      });
      const [entry] = await audits('inventory.equivalence.link');
      expect(entry.after).toMatchObject({ substitute: true, notes: 'Sello metálico en lugar de contacto.' });
      expect((await service.list({})).items[0]).toMatchObject({ substitute: true, notes: 'Sello metálico en lugar de contacto.' });
      expect((await service.listForProduct(skf, {})).items[0]).toMatchObject({ substitute: true, notes: 'Sello metálico en lugar de contacto.' });
    });

    it('is not a substitute and has no notes by default, and blank notes count as none', async () => {
      const created = await service.link({ productAId: skf, productBId: fag, notes: '   ' });
      expect(await base.equivalence.findUniqueOrThrow({ where: { id: created.id } })).toMatchObject({ substitute: false, notes: null });
      expect((await service.list({})).items[0]).toMatchObject({ substitute: false, notes: null });
    });

    it('rolls back the link when the audit cannot be written', async () => {
      const failing = new EquivalencesService(prisma, cls, { log: () => Promise.reject(new Error('audit down')) } as unknown as AuditService, new SettingsService(prisma));
      await expect(failing.link({ productAId: skf, productBId: fag })).rejects.toThrow('audit down');
      expect(await rowsOf(skf, fag)).toHaveLength(0);
    });

    it('leaves exactly one row when the same pair is linked at the same time, in both directions', async () => {
      const attempts = await Promise.allSettled([
        service.link({ productAId: skf, productBId: nsk }),
        service.link({ productAId: nsk, productBId: skf }),
        service.link({ productAId: skf, productBId: nsk }),
        service.link({ productAId: nsk, productBId: skf }),
      ]);
      expect(attempts.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const refused = attempts.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
      expect(refused).toHaveLength(3);
      for (const r of refused) expect(r.reason).toMatchObject({ response: { code: 'EQUIVALENCE_EXISTS' } });
      expect(await rowsOf(skf, nsk)).toHaveLength(1);
      expect(await audits('inventory.equivalence.link')).toHaveLength(1);
    });
  });

  describe('approval (decision #34)', () => {
    it('saves the link pending when the company requires approval, and lists it as pending', async () => {
      await setApproval(a.companyId, true);
      const created = await service.link({ productAId: skf, productBId: fag });
      expect(await base.equivalence.findUniqueOrThrow({ where: { id: created.id } })).toMatchObject({ approvedAt: null, approvedById: null });
      const [entry] = await audits('inventory.equivalence.link');
      expect(entry.after).toMatchObject({ approved: false });
      expect((await service.list({})).items[0].approvalState).toBe('PENDING_APPROVAL');
      const sheet = await service.listForProduct(skf, {});
      expect(sheet.items[0]).toMatchObject({ equivalenceId: created.id, approvalState: 'PENDING_APPROVAL' });
    });

    it('lists every link as approved when approval is not required, even one saved without a date', async () => {
      const [productAId, productBId] = normalizePair(skf, fag);
      await base.equivalence.create({ data: { companyId: a.companyId, productAId, productBId } });
      expect((await service.list({})).items[0].approvalState).toBe('APPROVED');
    });

    it('approves a pending link, records who and when, and audits before and after', async () => {
      await setApproval(a.companyId, true);
      const created = await service.link({ productAId: skf, productBId: fag });
      await service.approve(created.id);
      const row = await base.equivalence.findUniqueOrThrow({ where: { id: created.id } });
      expect(row.approvedById).toBe(userId);
      expect(row.approvedAt).not.toBeNull();
      const [entry] = await audits('inventory.equivalence.approve');
      expect(entry).toMatchObject({ entityId: created.id, userId });
      expect(entry.before).toMatchObject({ approvedAt: null });
      expect(entry.after).toMatchObject({ approvedById: userId });
      expect((await service.list({})).items[0].approvalState).toBe('APPROVED');
    });

    it('answers 409 EQUIVALENCE_ALREADY_APPROVED the second time, and when two approvals race', async () => {
      await setApproval(a.companyId, true);
      const created = await service.link({ productAId: skf, productBId: fag });
      const attempts = await Promise.allSettled([service.approve(created.id), service.approve(created.id)]);
      expect(attempts.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const [refused] = attempts.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
      expect(refused.reason).toMatchObject({ response: { code: 'EQUIVALENCE_ALREADY_APPROVED' } });
      await expect(service.approve(created.id)).rejects.toMatchObject({ response: { code: 'EQUIVALENCE_ALREADY_APPROVED' } });
      expect(await audits('inventory.equivalence.approve')).toHaveLength(1);
    });

    it('answers 404 EQUIVALENCE_NOT_FOUND for an unknown id', async () => {
      await expect(service.approve(randomUUID())).rejects.toMatchObject({ response: { code: 'EQUIVALENCE_NOT_FOUND' } });
    });
  });

  describe('unlink', () => {
    it('removes the link, keeps both products and audits the pair that was linked', async () => {
      const created = await service.link({ productAId: skf, productBId: diffSeal, substitute: true, notes: 'Sello distinto' });
      await service.unlink(created.id);
      expect(await base.equivalence.count({ where: { id: created.id } })).toBe(0);
      expect(await base.product.count({ where: { id: { in: [skf, diffSeal] } } })).toBe(2);
      const [entry] = await audits('inventory.equivalence.unlink');
      expect(entry).toMatchObject({ entityId: created.id, userId });
      expect(entry.before).toMatchObject({ substitute: true, notes: 'Sello distinto' });
      const pair = normalizePair(skf, diffSeal);
      expect(entry.before).toMatchObject({ productAId: pair[0], productBId: pair[1] });
    });

    it('lets the same pair be linked again afterwards', async () => {
      const created = await service.link({ productAId: skf, productBId: fag });
      await service.unlink(created.id);
      await expect(service.link({ productAId: skf, productBId: fag })).resolves.toMatchObject({ productAId: normalizePair(skf, fag)[0] });
    });

    it('answers 404 EQUIVALENCE_NOT_FOUND for an unknown id, for a second unlink and for another company', async () => {
      const created = await service.link({ productAId: skf, productBId: fag });
      await service.unlink(created.id);
      await expect(service.unlink(created.id)).rejects.toMatchObject({ response: { code: 'EQUIVALENCE_NOT_FOUND' } });
      await expect(service.unlink(randomUUID())).rejects.toBeInstanceOf(NotFoundException);

      const mine = await service.link({ productAId: skf, productBId: nsk });
      current = b.companyId;
      await expect(service.unlink(mine.id)).rejects.toMatchObject({ response: { code: 'EQUIVALENCE_NOT_FOUND' } });
      await expect(service.approve(mine.id)).rejects.toMatchObject({ response: { code: 'EQUIVALENCE_NOT_FOUND' } });
      current = a.companyId;
      expect(await base.equivalence.count({ where: { id: mine.id } })).toBe(1);
    });
  });

  describe('permissions', () => {
    const guardFor = (granted: string[]) => new PermissionsGuard(new Reflector(), { permissions: async () => new Set(granted) } as never);
    const contextOf = (handler: unknown) =>
      ({
        getHandler: () => handler,
        getClass: () => EquivalencesController,
        switchToHttp: () => ({ getRequest: () => ({ user: { mid: 'm1' } }) }),
      }) as never;
    const proto = EquivalencesController.prototype;

    it('asks for inventory.equivalences.link to validate, link and unlink, and answers 403 without it', async () => {
      const viewer = guardFor(['inventory.products.view', 'inventory.equivalences.approve']);
      for (const handler of [proto.validate, proto.link, proto.unlink]) {
        const refused = viewer.canActivate(contextOf(handler));
        await expect(refused).rejects.toBeInstanceOf(ForbiddenException);
        await expect(refused).rejects.toMatchObject({ response: { code: 'NO_PERMISSION', details: { missing: ['inventory.equivalences.link'] } } });
      }
      const linker = guardFor(['inventory.equivalences.link']);
      for (const handler of [proto.validate, proto.link, proto.unlink]) await expect(linker.canActivate(contextOf(handler))).resolves.toBe(true);
    });

    it('asks for inventory.equivalences.approve to approve, and answers 403 to who can only link', async () => {
      const refused = guardFor(['inventory.equivalences.link']).canActivate(contextOf(proto.approve));
      await expect(refused).rejects.toBeInstanceOf(ForbiddenException);
      await expect(refused).rejects.toMatchObject({ response: { details: { missing: ['inventory.equivalences.approve'] } } });
      await expect(guardFor(['inventory.equivalences.approve']).canActivate(contextOf(proto.approve))).resolves.toBe(true);
    });

    it('grants approval to administration and management but not to the warehouse role', () => {
      expect(DEFAULT_ROLES['admin'].permissions).toContain('inventory.equivalences.approve');
      expect(DEFAULT_ROLES['management'].permissions).toContain('inventory.equivalences.approve');
      expect(DEFAULT_ROLES['warehouse'].permissions).toContain('inventory.equivalences.link');
      expect(DEFAULT_ROLES['warehouse'].permissions).not.toContain('inventory.equivalences.approve');
    });
  });
});
