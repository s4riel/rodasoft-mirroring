import {
  type CodeHealth,
  type FiscalChecklistRow,
  type FiscalSectionKey,
  type FiscalSectionStatus,
  type HomologationRow,
  type PeriodBlockerCode,
  type PointOfSaleListItem,
  type VatPeriodAction,
  type VatPeriodRow,
} from '@rodasoft/domain';
import type { DocTableRow, DocTableStatus, RowMenuItem } from '@rodasoft/ui';
import { formatBs, formatDateTime } from '../sales/cash/cash-format';
import { periodLabel } from './credit-note-format';

// ── VAT periods (FS-37, FS-40) ──

export const PERIOD_STATUS_PILLS: Record<VatPeriodRow['status'], DocTableStatus> = {
  OPEN: { label: 'Abierto', status: 'warning' },
  CLOSED: { label: 'Cerrado', status: 'info', icon: 'check' },
  FILED: { label: 'Presentado', status: 'success', icon: 'check' },
};

const PERIOD_MENU: Record<VatPeriodAction, RowMenuItem> = {
  VIEW_BOOKS: { key: 'books', label: 'Ver libros', icon: 'eye' },
  CLOSE: { key: 'close', label: 'Cerrar período', icon: 'check' },
  FILE: { key: 'file', label: 'Marcar como presentado', icon: 'export' },
  REOPEN: { key: 'reopen', label: 'Reabrir período', icon: 'close', danger: true, separated: true },
};

export const periodMenuFor = (row: Pick<VatPeriodRow, 'actions'>): RowMenuItem[] => row.actions.map((action) => PERIOD_MENU[action]);

export function toPeriodRow(row: VatPeriodRow): DocTableRow {
  return {
    id: row.period,
    label: periodLabel(row.period),
    cells: {
      period: periodLabel(row.period),
      sales: String(row.salesCount),
      purchases: String(row.purchasesCount),
      debit: formatBs(row.fiscalDebit),
      credit: formatBs(row.vatCredit),
      status: PERIOD_STATUS_PILLS[row.status],
    },
  };
}

export const BLOCKER_LABELS: Record<PeriodBlockerCode, (count: number) => string> = {
  INVOICES_NOT_ISSUED: (n) => `${n} ${n === 1 ? 'factura sin emitir en el SIAT' : 'facturas sin emitir en el SIAT'}`,
  NOTES_NOT_ISSUED: (n) => `${n} ${n === 1 ? 'nota de crédito sin emitir en el SIAT' : 'notas de crédito sin emitir en el SIAT'}`,
  PURCHASES_OBSERVED: (n) => `${n} ${n === 1 ? 'compra observada' : 'compras observadas'}`,
  CANCELLATIONS_IN_PROGRESS: (n) => `${n} ${n === 1 ? 'anulación en curso en el SIAT' : 'anulaciones en curso en el SIAT'}`,
};

// ── Fiscal settings (FS-07) ──

export const SECTION_LABELS: Record<FiscalSectionKey, { title: string; description: string; link: string }> = {
  SIGNATURE: { title: 'Firma digital', description: 'Certificado .p12 con el que se firman las facturas.', link: '/invoicing/settings/credentials' },
  CREDENTIALS: { title: 'Credenciales del SIAT', description: 'Código de sistema y token delegado.', link: '/invoicing/settings/credentials' },
  CONNECTION: { title: 'Conexión con el SIAT', description: 'Última prueba de comunicación.', link: '/invoicing/status' },
  POINTS_OF_SALE: { title: 'Puntos de venta', description: 'Cajas registradas en el SIN con su CUIS.', link: '/invoicing/settings/points-of-sale' },
  CATALOGS: { title: 'Catálogos del SIN', description: 'Actividades, leyendas, productos y unidades.', link: '/invoicing/settings/catalogs' },
  ACTIVITY: { title: 'Actividad económica', description: 'Actividad principal que se imprime en las facturas.', link: '/invoicing/settings/catalogs' },
  HOMOLOGATION: { title: 'Homologación de productos', description: 'Código SIN de cada producto.', link: '/invoicing/settings/homologation' },
};

export const SECTION_PILLS: Record<FiscalSectionStatus, DocTableStatus> = {
  OK: { label: 'Completo', status: 'success', icon: 'check' },
  WARNING: { label: 'Revisar', status: 'warning', icon: 'alert' },
  PENDING: { label: 'Pendiente', status: 'danger', icon: 'alert' },
};

/** The fact a checklist row shows next to its title, in Spanish. */
export function sectionDetail(row: FiscalChecklistRow): string {
  if (row.detail === null) return '';
  switch (row.key) {
    case 'SIGNATURE':
    case 'CREDENTIALS':
      return `Vence el ${formatDateTime(row.detail).slice(0, 10)}`;
    case 'CONNECTION':
      return `Última prueba ${formatDateTime(row.detail)}`;
    case 'POINTS_OF_SALE':
      return `${row.detail} ${row.detail === '1' ? 'activo' : 'activos'}`;
    case 'CATALOGS':
      return `Sincronizados el ${formatDateTime(row.detail).slice(0, 10)}`;
    case 'ACTIVITY':
      return `Código ${row.detail}`;
    case 'HOMOLOGATION':
      return `${row.detail} productos`;
  }
}

export const HEALTH_PILLS: Record<CodeHealth, DocTableStatus> = {
  OK: { label: 'Vigente', status: 'success', icon: 'check' },
  EXPIRING: { label: 'Por vencer', status: 'warning', icon: 'alert' },
  EXPIRED: { label: 'Vencido', status: 'danger', icon: 'alert' },
};

// ── Points of sale (FS-32) ──

export function toPointOfSaleRow(point: PointOfSaleListItem): DocTableRow {
  return {
    id: point.id,
    label: point.name,
    cells: {
      code: String(point.code),
      branch: point.branchName,
      point: point.name,
      register: point.registerName ?? '—',
      lastInvoice: point.lastInvoiceNumber === null ? '—' : String(point.lastInvoiceNumber).padStart(6, '0'),
      cuis: point.status === 'INACTIVE' ? { label: 'Sin uso', status: 'idle' } : HEALTH_PILLS[point.cuisHealth],
      status: point.status === 'ACTIVE' ? { label: 'Activo', status: 'success', icon: 'check' } : { label: 'Inactivo', status: 'idle' },
    },
  };
}

// ── Homologation (FS-35) ──

export function toHomologationRow(row: HomologationRow): DocTableRow {
  return {
    id: row.id,
    label: row.sku,
    cells: {
      sku: row.sku,
      product: `${row.name}${row.brand ? ` · ${row.brand}` : ''}`,
      sin: row.sinProductCode ? `${row.sinProductCode}${row.sinDescription ? ` · ${row.sinDescription}` : ''}` : '—',
      unit: row.sinUnitCode === null ? '—' : String(row.sinUnitCode),
      status: row.status === 'DONE' ? { label: 'Homologado', status: 'success', icon: 'check' } : { label: 'Pendiente', status: 'warning', icon: 'alert' },
    },
  };
}

/** The size of a chosen file, in KB with one decimal (`12.3 KB`). */
export function fileSizeLabel(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KB`;
}
