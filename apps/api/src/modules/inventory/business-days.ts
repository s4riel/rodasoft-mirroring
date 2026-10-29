/** Business days are La Paz days (UTC-4, no daylight saving), not the server's. */
const LA_PAZ_OFFSET = '-04:00';

/** Start of a filter date: a plain `YYYY-MM-DD` is the start of that La Paz day, a full timestamp is taken as is. */
export function dayStart(value: string): Date {
  return new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00${LA_PAZ_OFFSET}` : value);
}

/** Exclusive end of a filter date: the start of the next La Paz day for a plain date. */
export function nextDayStart(value: string): Date {
  const start = dayStart(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(start.getTime() + 24 * 60 * 60 * 1000) : start;
}
