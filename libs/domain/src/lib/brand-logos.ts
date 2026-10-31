/**
 * Logo files of the brands, served by the ERP from its public assets (`apps/erp/public/brands`).
 * Keys are the brand names as the reference data spells them; a brand without a file keeps showing its initials.
 * Sources and licenses: `docs/brand-logos.md`.
 */
export const BRAND_LOGO_FILES: Readonly<Record<string, string>> = {
  SKF: 'skf.svg',
  INA: 'ina.svg',
  NSK: 'nsk.png',
  NTN: 'ntn.svg',
  TIMKEN: 'timken.svg',
  NACHI: 'nachi.svg',
  SACHS: 'sachs.svg',
  VALEO: 'valeo.svg',
  Fersa: 'fersa.png',
  NKE: 'nke.jpg',
};

export const BRAND_LOGO_PATH = '/brands';

/** URL of the logo of a brand, or null when the brand has none. */
export function brandLogoUrl(brandName: string): string | null {
  const file = BRAND_LOGO_FILES[brandName];
  return file ? `${BRAND_LOGO_PATH}/${file}` : null;
}
