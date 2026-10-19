/**
 * Máquina de estados mínima y explícita. Cada documento (factura, transferencia, OC…)
 * declara sus transiciones; el servicio llama a `assertTransition` antes de cambiar el estado
 * y registra el cambio en auditoría.
 */
export type Transitions<S extends string, E extends string> = Record<S, Partial<Record<E, S>>>;

export class InvalidTransitionError extends Error {
  constructor(
    readonly from: string,
    readonly event: string,
  ) {
    super(`Transición no permitida: "${event}" desde "${from}"`);
    this.name = 'InvalidTransitionError';
  }
}

export function createMachine<S extends string, E extends string>(transitions: Transitions<S, E>) {
  return {
    next(from: S, event: E): S {
      const to = transitions[from]?.[event];
      if (!to) throw new InvalidTransitionError(from, event);
      return to;
    },
    can(from: S, event: E): boolean {
      return !!transitions[from]?.[event];
    },
    events(from: S): E[] {
      return Object.keys(transitions[from] ?? {}) as E[];
    },
  };
}

// ── Transferencias entre sucursales (inventario-transferencias-flujo.md) ──
export type EstadoTransferencia =
  | 'BORRADOR'
  | 'POR_APROBAR'
  | 'APROBADA'
  | 'EN_TRANSITO'
  | 'RECIBIDA_PARCIAL'
  | 'RECIBIDA'
  | 'RECHAZADA'
  | 'ANULADA';
export type EventoTransferencia =
  | 'enviar'
  | 'pedirAprobacion'
  | 'aprobar'
  | 'rechazar'
  | 'despachar'
  | 'recibirParcial'
  | 'recibirTodo'
  | 'anular';

export const transferenciaMachine = createMachine<EstadoTransferencia, EventoTransferencia>({
  BORRADOR: { enviar: 'EN_TRANSITO', pedirAprobacion: 'POR_APROBAR', anular: 'ANULADA' },
  POR_APROBAR: { aprobar: 'APROBADA', rechazar: 'RECHAZADA' },
  APROBADA: { despachar: 'EN_TRANSITO', anular: 'ANULADA' },
  EN_TRANSITO: { recibirParcial: 'RECIBIDA_PARCIAL', recibirTodo: 'RECIBIDA' },
  RECIBIDA_PARCIAL: { recibirParcial: 'RECIBIDA_PARCIAL', recibirTodo: 'RECIBIDA' },
  RECIBIDA: {},
  RECHAZADA: {},
  ANULADA: {},
});

// ── Factura SIAT (facturacion-plan-cierre.md) ──
export type EstadoFactura =
  | 'PENDIENTE'
  | 'ENVIANDO'
  | 'VALIDA'
  | 'RECHAZADA'
  | 'CONTINGENCIA'
  | 'OBSERVADA'
  | 'ANULACION_PENDIENTE'
  | 'ANULADA';
export type EventoFactura =
  | 'enviar'
  | 'aceptar'
  | 'rechazar'
  | 'sinConexion'
  | 'paqueteValidado'
  | 'paqueteObservado'
  | 'corregir'
  | 'solicitarAnulacion'
  | 'aprobarAnulacion'
  | 'rechazarAnulacion';

export const facturaMachine = createMachine<EstadoFactura, EventoFactura>({
  PENDIENTE: { enviar: 'ENVIANDO', sinConexion: 'CONTINGENCIA' },
  ENVIANDO: { aceptar: 'VALIDA', rechazar: 'RECHAZADA', sinConexion: 'CONTINGENCIA' },
  RECHAZADA: { corregir: 'PENDIENTE' },
  CONTINGENCIA: { paqueteValidado: 'VALIDA', paqueteObservado: 'OBSERVADA' },
  OBSERVADA: { corregir: 'PENDIENTE' },
  VALIDA: { solicitarAnulacion: 'ANULACION_PENDIENTE' },
  ANULACION_PENDIENTE: { aprobarAnulacion: 'ANULADA', rechazarAnulacion: 'VALIDA' },
  ANULADA: {},
});
