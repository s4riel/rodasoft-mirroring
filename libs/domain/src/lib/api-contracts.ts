/** Contratos compartidos API ↔ ERP que no dependen del cliente generado por OpenAPI. */
import type { EmpresaContexto, SucursalContexto } from './tenancy';
import type { Permission } from './permissions';

export interface UsuarioActual {
  id: string;
  email: string;
  nombre: string;
  avatarUrl: string | null;
}

export interface SesionResponse {
  accessToken: string;
  expiresIn: number;
  usuario: UsuarioActual;
}

export interface ContextoResponse {
  usuario: UsuarioActual;
  empresa: EmpresaContexto;
  sucursales: SucursalContexto[];
  rol: { clave: string; nombre: string };
  permisos: Permission[];
}

/** Forma única de error de la API (ver ProblemFilter en apps/api). */
export interface ApiProblem {
  status: number;
  code: string;
  message: string;
  details?: unknown;
  traceId?: string;
}
