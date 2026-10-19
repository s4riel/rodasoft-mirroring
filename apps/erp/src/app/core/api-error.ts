import { HttpErrorResponse } from '@angular/common/http';
import type { ApiProblem } from '@rodasoft/domain';

/** Mensajes para los códigos de error de la API (pantallas BC-01b, BC-04, BC-08). */
const MESSAGES: Record<string, string> = {
  CREDENCIALES: 'Correo o contraseña incorrectos.',
  SIN_ACCESO: 'Tu cuenta no tiene acceso a esta empresa. Pide una invitación al administrador.',
  CUENTA_DESACTIVADA: 'Tu cuenta está desactivada. Habla con el administrador.',
  SESION_INVALIDA: 'Tu sesión expiró. Inicia sesión de nuevo.',
  EMPRESA_NO_EXISTE: 'Esta dirección no corresponde a ninguna empresa.',
  GOOGLE_CANCELADO: 'Cancelaste el acceso con Google.',
  GOOGLE_ESTADO: 'No pudimos validar el acceso con Google. Intenta de nuevo.',
  GOOGLE_NO_CONFIGURADO: 'El acceso con Google todavía no está configurado.',
  CODIGO_INVALIDO: 'El enlace de acceso expiró. Intenta de nuevo.',
  ENLACE_INVALIDO: 'El enlace expiró o ya fue usado. Pide uno nuevo.',
  THROTTLED: 'Demasiados intentos. Espera un minuto.',
  NETWORK: 'No hay conexión con el servidor. Revisa tu internet.',
};

export function problemOf(err: unknown): ApiProblem {
  if (err instanceof HttpErrorResponse) {
    if (err.status === 0) return { status: 0, code: 'NETWORK', message: MESSAGES['NETWORK'] };
    if (err.status === 429) return { status: 429, code: 'THROTTLED', message: MESSAGES['THROTTLED'] };
    const body = err.error as Partial<ApiProblem> | null;
    const code = body?.code ?? 'ERROR';
    return { status: err.status, code, message: MESSAGES[code] ?? body?.message ?? 'Ocurrió un error.', details: body?.details };
  }
  return { status: 0, code: 'ERROR', message: 'Ocurrió un error inesperado.' };
}

export const messageFor = (code: string | null | undefined) => (code ? (MESSAGES[code] ?? null) : null);
