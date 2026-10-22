import { HttpErrorResponse } from '@angular/common/http';
import type { ApiProblem } from '@rodasoft/domain';

/** User-facing (Spanish) messages for the API error codes (screens BC-01b, BC-04, BC-08). */
const MESSAGES: Record<string, string> = {
  INVALID_CREDENTIALS: 'Correo o contraseña incorrectos.',
  NO_ACCESS: 'Tu cuenta no tiene acceso a esta empresa. Pide una invitación al administrador.',
  ACCOUNT_DISABLED: 'Tu cuenta está desactivada. Habla con el administrador.',
  INVALID_SESSION: 'Tu sesión expiró. Inicia sesión de nuevo.',
  COMPANY_NOT_FOUND: 'Esta dirección no corresponde a ninguna empresa.',
  GOOGLE_CANCELLED: 'Cancelaste el acceso con Google.',
  GOOGLE_STATE: 'No pudimos validar el acceso con Google. Intenta de nuevo.',
  GOOGLE_NOT_CONFIGURED: 'El acceso con Google todavía no está configurado.',
  INVALID_CODE: 'El enlace de acceso expiró. Intenta de nuevo.',
  INVALID_LINK: 'El enlace expiró o ya fue usado. Pide uno nuevo.',
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
