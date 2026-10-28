/** BullMQ queues. One queue per job type, to scale and retry separately. */
export const QUEUE = {
  mail: 'mail',
  siat: 'siat',
  accounting: 'accounting',
  inventory: 'inventory',
} as const;

export type QueueName = (typeof QUEUE)[keyof typeof QUEUE];

/** Which queue each outbox event type goes to (see OutboxType in apps/api). */
export const OUTBOX_ROUTES: Record<string, QueueName> = {
  'auth.password-reset': QUEUE.mail,
  'auth.invitation': QUEUE.mail,
  'invoice.issue': QUEUE.siat,
  'invoice.cancel': QUEUE.siat,
  'sale.confirmed': QUEUE.accounting,
  'entry.generate': QUEUE.accounting,
  'inventory.product-created': QUEUE.inventory,
  'inventory.product-updated': QUEUE.inventory,
  'inventory.product-status-changed': QUEUE.inventory,
  'inventory.stock.changed': QUEUE.inventory,
  'inventory.warehouse.changed': QUEUE.inventory,
  'inventory.transfer.sent': QUEUE.inventory,
  'inventory.transfer.approval-requested': QUEUE.inventory,
};

export const DEFAULT_JOB_OPTS = {
  attempts: 8,
  backoff: { type: 'exponential' as const, delay: 5_000 },
  removeOnComplete: { age: 7 * 86_400, count: 5_000 },
  removeOnFail: { age: 30 * 86_400 },
};
