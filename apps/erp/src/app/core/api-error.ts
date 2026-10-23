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
  DUPLICATE_MANUFACTURER_CODE: 'Ya existe un producto con este código para la marca.',
  PRODUCT_HAS_STOCK: 'No se puede eliminar: tiene stock registrado. Desactívalo en su lugar.',
  PRODUCT_HAS_MOVEMENTS: 'No se puede eliminar: tiene movimientos de stock. Desactívalo en su lugar.',
  PRODUCT_NOT_FOUND: 'El producto ya no existe. Actualiza el listado.',
  BRAND_NOT_FOUND: 'La marca elegida ya no existe.',
  COUNTRY_NOT_FOUND: 'La industria elegida ya no existe.',
  PRICE_REQUIRED: 'Falta el precio de venta. Ingrésalo para activar el producto.',
  NOT_A_DRAFT: 'Este producto ya no es un borrador. Ábrelo desde el listado.',
  EQUIVALENCE_EXISTS: 'Estos productos ya están vinculados como equivalentes.',
  SELF_LINK: 'Un producto no puede ser equivalente de sí mismo.',
  BRANCH_NOT_ALLOWED: 'No puedes operar en esta sucursal.',
  BRANCH_REQUIRED: 'Elige la sucursal que recibe el producto.',
  CATEGORY_NOT_FOUND: 'La categoría elegida ya no existe.',
  WAREHOUSE_NOT_FOUND: 'La sucursal no tiene almacén principal. Configúralo primero.',
  WAREHOUSE_INACTIVE: 'El almacén está inactivo y no puede recibir stock.',
  MAX_BELOW_MIN: 'El stock máximo no puede ser menor que el mínimo.',
  INVALID_DATE: 'La fecha de ingreso no es válida.',
  VALIDATION_FAILED: 'Revisa los datos ingresados.',
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
