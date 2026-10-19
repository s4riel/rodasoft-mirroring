import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MissingTenantError, TENANT_MODELS, tenantExtension, UNSCOPED_MODELS } from './tenant.extension';

type AllOps = (p: { model?: string; operation: string; args: any; query: (a: any) => any }) => Promise<any>;

// Prisma.defineExtension devuelve el mismo objeto: se puede probar el hook sin base de datos
const hook = (empresaId: string | null): AllOps =>
  (tenantExtension(() => empresaId) as any).query.$allModels.$allOperations;

describe('tenantExtension', () => {
  it('filtra lecturas y actualizaciones por empresa', async () => {
    const args = await hook('e1')({ model: 'Sucursal', operation: 'findMany', args: { where: { codigo: 0 } }, query: (a) => a });
    expect(args.where).toEqual({ codigo: 0, empresaId: 'e1' });
  });

  it('completa empresaId en altas simples y masivas', async () => {
    const one = await hook('e1')({ model: 'Almacen', operation: 'create', args: { data: { codigo: 'HK-01' } }, query: (a) => a });
    expect(one.data.empresaId).toBe('e1');
    const many = await hook('e1')({ model: 'Rol', operation: 'createMany', args: { data: [{ clave: 'a' }, { clave: 'b' }] }, query: (a) => a });
    expect(many.data.map((r: any) => r.empresaId)).toEqual(['e1', 'e1']);
  });

  it('falla si no hay empresa en el contexto', async () => {
    await expect(hook(null)({ model: 'Sucursal', operation: 'findMany', args: {}, query: (a) => a })).rejects.toBeInstanceOf(
      MissingTenantError,
    );
  });

  it('no toca modelos globales', async () => {
    const args = await hook(null)({ model: 'Usuario', operation: 'findMany', args: {}, query: (a) => a });
    expect(args).toEqual({});
  });

  it('todo modelo con empresaId está declarado como filtrado o como excepción', () => {
    const schema = readFileSync(join(__dirname, '../../../prisma/schema.prisma'), 'utf8');
    const models = [...schema.matchAll(/model (\w+) \{([\s\S]*?)\n\}/g)]
      .filter(([, , body]) => /\n\s+empresaId\s/.test(body))
      .map(([, name]) => name);
    const sinDeclarar = models.filter((m) => !TENANT_MODELS.has(m as any) && !UNSCOPED_MODELS.has(m));
    expect(sinDeclarar).toEqual([]);
  });
});
