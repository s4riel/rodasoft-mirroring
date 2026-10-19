/** Colas de BullMQ. Una cola por tipo de trabajo, para escalar y reintentar por separado. */
export const QUEUE = {
  mail: 'mail',
  siat: 'siat',
  contabilidad: 'contabilidad',
} as const;

export type QueueName = (typeof QUEUE)[keyof typeof QUEUE];

/** A qué cola va cada tipo de evento del outbox (ver OutboxTipo en apps/api). */
export const OUTBOX_ROUTES: Record<string, QueueName> = {
  'auth.password-reset': QUEUE.mail,
  'auth.invitacion': QUEUE.mail,
  'factura.emitir': QUEUE.siat,
  'factura.anular': QUEUE.siat,
  'venta.confirmada': QUEUE.contabilidad,
  'asiento.generar': QUEUE.contabilidad,
};

export const DEFAULT_JOB_OPTS = {
  attempts: 8,
  backoff: { type: 'exponential' as const, delay: 5_000 },
  removeOnComplete: { age: 7 * 86_400, count: 5_000 },
  removeOnFail: { age: 30 * 86_400 },
};
