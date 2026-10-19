import type { ClsStore } from 'nestjs-cls';

/** Contexto por solicitud (AsyncLocalStorage). Lo llenan el middleware de CLS y TenantGuard. */
export interface AppClsStore extends ClsStore {
  /** slug pedido por la URL/encabezado (antes de autenticar) */
  empresaSlug: string | null;
  /** empresa ya validada contra la membresía del usuario */
  empresaId: string | null;
  usuarioId: string | null;
  membresiaId: string | null;
  ip: string | null;
  userAgent: string | null;
}
