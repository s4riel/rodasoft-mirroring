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
  'sale.completed': QUEUE.accounting,
  'sale.receipt-email': QUEUE.mail,
  'sales.quote-email': QUEUE.mail,
  'sales.cash-shift.opened': QUEUE.accounting,
  'sales.cash-shift.float-mismatch': QUEUE.accounting,
  // HU-VEN-22 and 23: no consumer yet either; Accounting reviews differences and Management approves expenses in HU-VEN-24 and 29
  'sales.cash-shift.closed': QUEUE.accounting,
  'sales.cash-shift.difference': QUEUE.accounting,
  'sales.cash-movement.created': QUEUE.accounting,
  'sales.cash-expense.requested': QUEUE.accounting,
  'sales.cash-expense.decided': QUEUE.accounting,
  // until the approvals inbox (HU-VEN-29) has its own consumer, like the cash shift events
  'sales.cancellation.requested': QUEUE.accounting,
  'sales.cancellation.withdrawn': QUEUE.accounting,
  'sales.cancellation.approved': QUEUE.accounting,
  'sales.cancellation.rejected': QUEUE.accounting,
  // the SIAT consumer of `sales.return.completed` (HU-FAC) issues the credit and debit note; until then accounting just logs it
  'sales.return.requested': QUEUE.accounting,
  'sales.return.completed': QUEUE.accounting,
  'sales.return.rejected': QUEUE.accounting,
  'entry.generate': QUEUE.accounting,
  'inventory.product-created': QUEUE.inventory,
  'inventory.product-updated': QUEUE.inventory,
  'inventory.product-status-changed': QUEUE.inventory,
  'inventory.stock.changed': QUEUE.inventory,
  'inventory.warehouse.changed': QUEUE.inventory,
  'inventory.transfer.sent': QUEUE.inventory,
  'inventory.transfer.cancelled': QUEUE.inventory,
  'inventory.transfer.received_partial': QUEUE.inventory,
  'inventory.transfer.received': QUEUE.inventory,
  'inventory.adjustment.pending': QUEUE.inventory,
};

export const DEFAULT_JOB_OPTS = {
  attempts: 8,
  backoff: { type: 'exponential' as const, delay: 5_000 },
  removeOnComplete: { age: 7 * 86_400, count: 5_000 },
  removeOnFail: { age: 30 * 86_400 },
};
