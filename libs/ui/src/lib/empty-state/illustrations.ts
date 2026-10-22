/**
 * Illustration artwork, viewBox 240x180 (Figma: Illustration/* symbols). Every colour is a CSS variable so the
 * scenes follow light/dark and the active brand (fills bound to --brand-*, --status-*, --bg-*).
 * NOTE: redrawn from the Figma node names (the Figma MCP quota was exhausted when this was written); replace the
 * bodies with the exported SVG paths keeping the var(--…) fills when the export is available.
 */
export type IllustrationName =
  | 'no-results'
  | 'empty-catalog'
  | 'no-equivalents'
  | 'no-access'
  | 'empty-transfer'
  | 'all-clear'
  | 'no-invoices'
  | 'siat-offline'
  | 'cash-closed'
  | 'no-contacts'
  | 'no-purchase-orders'
  | 'no-movements'
  | 'error'
  | 'empty-cart';

export const ILLUSTRATION_NAMES: readonly IllustrationName[] = [
  'no-results',
  'empty-catalog',
  'no-equivalents',
  'no-access',
  'empty-transfer',
  'all-clear',
  'no-invoices',
  'siat-offline',
  'cash-closed',
  'no-contacts',
  'no-purchase-orders',
  'no-movements',
  'error',
  'empty-cart',
];

const SOFT = 'fill:var(--brand-primary-soft)';
const BRAND = 'fill:var(--brand-primary)';
const SURFACE = 'fill:var(--bg-surface)';
const SURFACE2 = 'fill:var(--bg-surface-2)';
const INK = 'fill:var(--text-primary)';
const LINE = 'stroke:var(--border-control);stroke-width:2;fill:none;stroke-linecap:round;stroke-linejoin:round';
const LINE_SOFT = 'stroke:var(--border-default);stroke-width:2;fill:none;stroke-linecap:round';
const BRAND_LINE = 'stroke:var(--brand-primary);stroke-width:3;fill:none;stroke-linecap:round;stroke-linejoin:round';

/** Shared stage: soft disc + ground shadow. */
const STAGE = `<circle cx="120" cy="84" r="66" style="${SOFT}"/><ellipse cx="120" cy="160" rx="72" ry="8" style="${SURFACE2}"/>`;

function bearing(cx: number, cy: number, r: number): string {
  return (
    `<circle cx="${cx}" cy="${cy}" r="${r}" style="${SURFACE};${LINE}"/>` +
    `<circle cx="${cx}" cy="${cy}" r="${(r * 0.55).toFixed(1)}" style="${SURFACE2};${LINE}"/>` +
    `<circle cx="${cx}" cy="${cy}" r="${(r * 0.18).toFixed(1)}" style="${BRAND}"/>`
  );
}

function sparkle(x: number, y: number): string {
  return `<path d="M${x} ${y - 6}v12M${x - 6} ${y}h12" style="${BRAND_LINE};stroke-width:2"/>`;
}

export const ILLUSTRATIONS: Record<IllustrationName, string> = {
  'no-results': `${STAGE}
    <rect x="68" y="52" width="76" height="52" rx="10" style="${SURFACE};${LINE}"/>
    <path d="M80 68h40M80 80h28M80 92h34" style="${LINE_SOFT}"/>
    <circle cx="136" cy="94" r="26" style="${SURFACE};${BRAND_LINE}"/>
    <path d="M155 113l22 24" style="${BRAND_LINE};stroke-width:7"/>
    <path d="M128 86l16 16M144 86l-16 16" style="${LINE}"/>
    ${sparkle(176, 56)}`,
  'empty-catalog': `${STAGE}
    <path d="M70 76l50-22 50 22v52l-50 22-50-22z" style="${SURFACE};${LINE}"/>
    <path d="M70 76l50 22 50-22M120 98v52" style="${LINE}"/>
    <path d="M70 76l-14-18 38-14M170 76l14-18-38-14" style="${LINE}"/>
    <path d="M100 118h16" style="${LINE_SOFT}"/>
    ${sparkle(184, 48)}${sparkle(54, 100)}`,
  'no-equivalents': `${STAGE}
    ${bearing(74, 84, 32)}
    ${bearing(166, 84, 32)}
    <path d="M108 76h24M108 92h24" style="${BRAND_LINE}"/>
    <path d="M118 104l4-40" style="${BRAND_LINE}"/>`,
  'no-access': `${STAGE}
    <path d="M94 82V66a26 26 0 0 1 52 0v16" style="${LINE};stroke-width:6"/>
    <rect x="80" y="80" width="80" height="62" rx="14" style="${SURFACE};${LINE}"/>
    <circle cx="120" cy="106" r="8" style="${BRAND}"/>
    <path d="M120 112v14" style="${BRAND_LINE}"/>`,
  'empty-transfer': `${STAGE}
    <rect x="44" y="70" width="52" height="52" rx="10" style="${SURFACE};${LINE}"/>
    <rect x="144" y="70" width="52" height="52" rx="10" style="${SURFACE};${LINE}"/>
    <path d="M58 90h24M58 102h16M158 90h24M158 102h16" style="${LINE_SOFT}"/>
    <path d="M104 84h32M128 76l8 8-8 8" style="${BRAND_LINE}"/>
    <path d="M136 108h-32M112 100l-8 8 8 8" style="${LINE}"/>`,
  'all-clear': `${STAGE}
    <circle cx="120" cy="84" r="42" style="${SURFACE};stroke:var(--status-success);stroke-width:4"/>
    <circle cx="120" cy="84" r="32" style="fill:var(--status-success-soft)"/>
    <path d="M102 85l12 12 24-26" style="stroke:var(--status-success);stroke-width:7;fill:none;stroke-linecap:round;stroke-linejoin:round"/>
    ${sparkle(176, 48)}${sparkle(62, 62)}`,
  'no-invoices': `${STAGE}
    <path d="M82 40h56l24 24v82H82z" style="${SURFACE};${LINE}"/>
    <path d="M138 40v24h24" style="${LINE}"/>
    <path d="M96 84h50M96 98h50M96 112h30" style="${LINE_SOFT}"/>
    <circle cx="150" cy="124" r="20" style="${SURFACE};${BRAND_LINE}"/>
    <path d="M141 124h18" style="${BRAND_LINE}"/>`,
  'siat-offline': `${STAGE}
    <path d="M82 120a24 24 0 0 1 4-47 34 34 0 0 1 64-6 28 28 0 0 1 8 53z" style="${SURFACE};${LINE}"/>
    <path d="M96 140L148 52" style="stroke:var(--status-warning);stroke-width:5;fill:none;stroke-linecap:round"/>
    <circle cx="170" cy="130" r="16" style="fill:var(--status-warning-soft);stroke:var(--status-warning);stroke-width:3"/>
    <path d="M170 123v8M170 136h.01" style="stroke:var(--status-warning);stroke-width:3;fill:none;stroke-linecap:round"/>`,
  'cash-closed': `${STAGE}
    <rect x="56" y="82" width="128" height="60" rx="12" style="${SURFACE};${LINE}"/>
    <path d="M56 100h128" style="${LINE}"/>
    <rect x="76" y="48" width="88" height="40" rx="8" style="${SURFACE2};${LINE}"/>
    <path d="M88 62h40M88 74h24" style="${LINE_SOFT}"/>
    <rect x="104" y="112" width="32" height="14" rx="7" style="fill:var(--status-danger-soft);stroke:var(--status-danger);stroke-width:2"/>
    <path d="M70 130h16" style="${LINE_SOFT}"/>
    ${sparkle(190, 56)}`,
  'no-contacts': `${STAGE}
    <circle cx="120" cy="68" r="22" style="${SURFACE};${LINE}"/>
    <path d="M76 142c2-28 20-40 44-40s42 12 44 40z" style="${SURFACE};${LINE}"/>
    <circle cx="164" cy="60" r="16" style="${SURFACE};${BRAND_LINE}"/>
    <path d="M164 53v14M157 60h14" style="${BRAND_LINE};stroke-width:2.5"/>`,
  'no-purchase-orders': `${STAGE}
    <rect x="76" y="44" width="88" height="106" rx="12" style="${SURFACE};${LINE}"/>
    <rect x="102" y="36" width="36" height="16" rx="6" style="${INK}"/>
    <path d="M92 76h56M92 92h56M92 108h36" style="${LINE_SOFT}"/>
    <circle cx="150" cy="130" r="18" style="${BRAND}"/>
    <path d="M142 130h16" style="stroke:var(--brand-on-primary);stroke-width:3;fill:none;stroke-linecap:round"/>`,
  'no-movements': `${STAGE}
    <rect x="52" y="52" width="136" height="88" rx="12" style="${SURFACE};${LINE}"/>
    <path d="M68 128h104M68 76h104M68 102h104" style="${LINE_SOFT}"/>
    <path d="M68 114h104" style="${BRAND_LINE}"/>
    <circle cx="68" cy="114" r="5" style="${BRAND}"/>
    <circle cx="172" cy="114" r="5" style="${BRAND}"/>`,
  error: `${STAGE}
    <path d="M120 42l50 88H70z" style="${SURFACE};stroke:var(--status-danger);stroke-width:5;stroke-linejoin:round"/>
    <path d="M120 70v32" style="stroke:var(--status-danger);stroke-width:7;fill:none;stroke-linecap:round"/>
    <circle cx="120" cy="116" r="5" style="fill:var(--status-danger)"/>
    ${sparkle(184, 52)}`,
  'empty-cart': `${STAGE}
    <path d="M60 52h22l14 62h62l12-46H88" style="${LINE};stroke-width:5"/>
    <path d="M96 114l-4 14h86" style="${LINE}"/>
    <circle cx="106" cy="144" r="9" style="${SURFACE};${LINE}"/>
    <circle cx="160" cy="144" r="9" style="${SURFACE};${LINE}"/>
    <path d="M104 84h24M108 96h14" style="${LINE_SOFT}"/>
    ${sparkle(176, 46)}`,
};
