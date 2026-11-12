import { APPROVAL_INLINE_TYPES, APPROVAL_TYPE_PERMISSION, APPROVAL_TYPES, approvalTypesFor, isApprovalType, isInlineApprovalType } from './approvals';
import { PERMISSIONS } from './permissions';

describe('approvals', () => {
  it('maps every type to a permission that exists', () => {
    for (const type of APPROVAL_TYPES) expect(Object.keys(PERMISSIONS)).toContain(APPROVAL_TYPE_PERMISSION[type]);
  });

  it('lists the types a user may decide, in the inbox order', () => {
    expect(approvalTypesFor([])).toEqual([]);
    expect(approvalTypesFor(['sales.pos.use', 'sales.prices.edit'])).toEqual([]);
    expect(approvalTypesFor(['sales.cash-register.review'])).toEqual(['CASH_DIFFERENCE']);
    expect(approvalTypesFor(new Set(['sales.cash-expenses.approve', 'sales.cancellations.approve']))).toEqual(['CANCELLATION', 'CASH_EXPENSE']);
    expect(approvalTypesFor(Object.values(APPROVAL_TYPE_PERMISSION))).toEqual([...APPROVAL_TYPES]);
  });

  it('decides only returns and cash expenses inline', () => {
    expect([...APPROVAL_INLINE_TYPES]).toEqual(['RETURN', 'CASH_EXPENSE']);
    expect(isInlineApprovalType('RETURN')).toBe(true);
    expect(isInlineApprovalType('CANCELLATION')).toBe(false);
    expect(isInlineApprovalType('CASH_DIFFERENCE')).toBe(false);
  });

  it('recognises the type names', () => {
    expect(isApprovalType('RETURN')).toBe(true);
    expect(isApprovalType('DISCOUNT')).toBe(false);
    expect(isApprovalType(undefined)).toBe(false);
  });
});
