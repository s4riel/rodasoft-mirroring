/**
 * The approvals inbox (HU-VEN-29, VP-25): one list of everything that waits for a decision, grouped by type. The inbox only reads
 * the `approval_requests` table; each request is still decided through the endpoint of its own type, so the audit entry, the
 * state machine and the side effects (stock, cash, credit note) stay in one place. Pure rules plus the contracts of the API.
 */
import type { Permission } from './permissions';

/** The kinds of request that wait for a decision. Discounts have none: they are per customer (decision #5). */
export const APPROVAL_TYPES = ['CANCELLATION', 'CASH_DIFFERENCE', 'RETURN', 'CASH_EXPENSE', 'NIT_EXCEPTION'] as const;
export type ApprovalType = (typeof APPROVAL_TYPES)[number];

/** The permission that lets a user decide each type (decisions #11, #15, #16, #17, #21). */
export const APPROVAL_TYPE_PERMISSION: Readonly<Record<ApprovalType, Permission>> = {
  CANCELLATION: 'sales.cancellations.approve',
  CASH_DIFFERENCE: 'sales.cash-register.review',
  RETURN: 'sales.returns.approve',
  CASH_EXPENSE: 'sales.cash-expenses.approve',
  NIT_EXCEPTION: 'invoicing.nit-exception.approve',
};

/** The types decided from the inbox itself; the others open their own review page. */
export const APPROVAL_INLINE_TYPES: readonly ApprovalType[] = ['RETURN', 'CASH_EXPENSE', 'NIT_EXCEPTION'];

/** Most requests the inbox lists at once, oldest first. */
export const APPROVAL_INBOX_MAX = 200;

/** `reason` of a decision typed in the inbox (the same limit as the decision endpoints). */
export const APPROVAL_COMMENT_MAX = 500;

export function isApprovalType(value: unknown): value is ApprovalType {
  return typeof value === 'string' && (APPROVAL_TYPES as readonly string[]).includes(value);
}

export function isInlineApprovalType(type: ApprovalType): boolean {
  return APPROVAL_INLINE_TYPES.includes(type);
}

/** The types a user may see and decide, in the order the inbox lists them. */
export function approvalTypesFor(permissions: Iterable<string>): ApprovalType[] {
  const granted = new Set(permissions);
  return APPROVAL_TYPES.filter((type) => granted.has(APPROVAL_TYPE_PERMISSION[type]));
}

// ── Contracts ──

export interface ApprovalInboxItem {
  /** Id of the `approval_requests` row. */
  id: string;
  type: ApprovalType;
  /** The sale, shift, return or cash movement the request is about. */
  subjectId: string;
  /** Number of the document: the sale (`V-000231`), shift (`T-0142`) or return (`DEV-000012`); a cash expense shows its shift. */
  number: string;
  /** Sale a return belongs to. */
  saleNumber: string | null;
  customerName: string | null;
  registerName: string | null;
  /** Pieces of a return. */
  pieces: number | null;
  requestedBy: string;
  requestedAt: string;
  /** The reason code the requester chose (a cancellation reason, a return reason or an expense concept). */
  reason: string | null;
  /** What the requester wrote. */
  comment: string | null;
  /** Signed: negative when the money leaves the company (a cancellation, a return, an expense), the signed difference of a shift. */
  amount: string | null;
  /** False on the caller's own shift: nobody reviews their own closing. */
  canDecide: boolean;
}

export interface ApprovalInboxGroup {
  type: ApprovalType;
  count: number;
  items: ApprovalInboxItem[];
}

export interface ApprovalInboxKpis {
  pending: number;
  /** When the oldest pending request was made; null when none is pending. */
  oldestAt: string | null;
  /** Decisions of the La Paz day, by anyone in the caller's scope. An observed shift counts as rejected. */
  approvedToday: number;
  rejectedToday: number;
}

export interface ApprovalInboxResponse {
  /** One group per type the caller may decide, empty ones included; only the asked type when the query has one. */
  groups: ApprovalInboxGroup[];
  kpis: ApprovalInboxKpis;
  /** True when more than `APPROVAL_INBOX_MAX` requests are pending and the oldest ones are shown. */
  truncated: boolean;
}

/** The count behind the badge of the Aprobaciones tab. */
export interface ApprovalInboxSummary {
  pending: number;
}
