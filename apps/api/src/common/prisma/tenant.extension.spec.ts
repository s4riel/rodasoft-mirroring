import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MissingTenantError, TENANT_MODELS, tenantHook, UNSCOPED_MODELS } from './tenant.extension';

type AllOps = (p: { model?: string; operation: string; args: any; query: (a: any) => any }) => Promise<any>;

// the hook is tested directly, without a database
const hook = (companyId: string | null): AllOps => tenantHook(() => companyId);

describe('tenantExtension', () => {
  it('filters reads and updates by company', async () => {
    const args = await hook('e1')({
      model: 'Branch',
      operation: 'findMany',
      args: { where: { code: 0 } },
      query: (a) => a,
    });
    expect(args.where).toEqual({ code: 0, companyId: 'e1' });
  });

  it('fills companyId on single and bulk creates', async () => {
    const one = await hook('e1')({
      model: 'Warehouse',
      operation: 'create',
      args: { data: { code: 'HK-01' } },
      query: (a) => a,
    });
    expect(one.data.companyId).toBe('e1');
    const many = await hook('e1')({
      model: 'Role',
      operation: 'createMany',
      args: { data: [{ key: 'a' }, { key: 'b' }] },
      query: (a) => a,
    });
    expect(many.data.map((r: any) => r.companyId)).toEqual(['e1', 'e1']);
  });

  it('fails when there is no company in context', async () => {
    await expect(
      hook(null)({ model: 'Branch', operation: 'findMany', args: {}, query: (a) => a }),
    ).rejects.toBeInstanceOf(MissingTenantError);
  });

  it('does not touch global models', async () => {
    const args = await hook(null)({ model: 'User', operation: 'findMany', args: {}, query: (a) => a });
    expect(args).toEqual({});
  });

  it('every model with companyId is declared as filtered or as an exception', () => {
    const schema = readFileSync(join(__dirname, '../../../prisma/schema.prisma'), 'utf8');
    const models = [...schema.matchAll(/model (\w+) \{([\s\S]*?)\n\}/g)]
      .filter(([, , body]) => /\n\s+companyId\s/.test(body))
      .map(([, name]) => name);
    const undeclared = models.filter((m) => !TENANT_MODELS.has(m as any) && !UNSCOPED_MODELS.has(m));
    expect(undeclared).toEqual([]);
  });
});
