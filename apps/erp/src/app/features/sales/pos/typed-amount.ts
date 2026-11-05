import { Decimal, MONEY_SCALE } from '@rodasoft/domain';

/** What the amount looks like when typed: no cents when there are none ("1150"), a comma otherwise ("1150,5"). */
export function typedAmount(amount: Decimal): string {
  const [integer, cents] = amount.round(MONEY_SCALE).toString().split('.');
  return cents === '00' ? integer : `${integer},${cents.replace(/0$/, '')}`;
}
