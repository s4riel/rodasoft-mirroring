import type { TransferDetail } from '@rodasoft/domain';

/** One step of the Enviada → En tránsito → Recibida tracker of IN-24a. */
export interface TrackerStep {
  key: 'sent' | 'transit' | 'received';
  label: string;
  /** The line under the label: where and when, or what is awaited. */
  detail: string;
  state: 'done' | 'current' | 'upcoming';
}

/**
 * The tracker of a sent transfer. A cancelled or rejected transfer never travelled, so it has none; one received in part
 * stays on "En tránsito" until the receipt is closed.
 */
export function trackerOf(detail: TransferDetail, formatDayTime: (iso: string | null) => string): TrackerStep[] {
  if (detail.status !== 'IN_TRANSIT' && detail.status !== 'PARTIALLY_RECEIVED' && detail.status !== 'RECEIVED') return [];
  const received = detail.status === 'RECEIVED';
  const destination = detail.destination.branch.name;
  return [
    { key: 'sent', label: 'Enviada', detail: `${detail.origin.branch.name} · ${formatDayTime(detail.sentAt)}`, state: 'done' },
    {
      key: 'transit',
      label: 'En tránsito',
      detail: received ? 'Llegó a destino' : detail.status === 'PARTIALLY_RECEIVED' ? `Recibida en parte en ${destination}` : `Esperando recepción en ${destination}`,
      state: received ? 'done' : 'current',
    },
    {
      key: 'received',
      label: 'Recibida',
      detail: received ? `${destination} · ${formatDayTime(detail.receivedAt)}` : `${destination} · pendiente`,
      state: received ? 'done' : 'upcoming',
    },
  ];
}
