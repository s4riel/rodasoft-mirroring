import type { Prisma } from '@prisma/client';
import type { CurrentCashShift } from '@rodasoft/domain';

export const SHIFT_WITH_PLACE = {
  register: { select: { id: true, name: true, branch: { select: { id: true, name: true } }, warehouse: { select: { id: true, name: true } } } },
} as const satisfies Prisma.CashShiftInclude;

export type ShiftWithPlace = Prisma.CashShiftGetPayload<{ include: typeof SHIFT_WITH_PLACE }>;

export function toCurrentShift(shift: ShiftWithPlace, openedByName: string): CurrentCashShift {
  return {
    id: shift.id,
    number: shift.number,
    openingFloat: shift.openingFloat.toFixed(2),
    openedAt: shift.openedAt.toISOString(),
    openedBy: { id: shift.openedById, name: openedByName },
    register: { id: shift.register.id, name: shift.register.name },
    branch: shift.register.branch,
    warehouse: shift.register.warehouse,
  };
}
