import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { BRAND_LOGO_FILES, BRAND_LOGO_PATH, brandLogoUrl } from './brand-logos';

const PUBLIC_BRANDS = join(__dirname, '../../../../apps/erp/public', BRAND_LOGO_PATH);

describe('brand logos', () => {
  it('builds the URL of a brand with a logo and gives null to the others', () => {
    expect(brandLogoUrl('SKF')).toBe('/brands/skf.svg');
    expect(brandLogoUrl('Fersa')).toBe('/brands/fersa.png');
    expect(brandLogoUrl('A&S')).toBeNull();
    expect(brandLogoUrl('skf')).toBeNull(); // names are matched as the reference data spells them
  });

  it.each(Object.entries(BRAND_LOGO_FILES))('has the file of %s in the ERP assets', (_brand, file) => {
    const path = join(PUBLIC_BRANDS, file);
    expect(existsSync(path)).toBe(true);
    expect(statSync(path).size).toBeGreaterThan(500);
  });

  it('ships SVG logos without scripts, event handlers or external references', () => {
    for (const file of Object.values(BRAND_LOGO_FILES).filter((f) => f.endsWith('.svg'))) {
      const svg = readFileSync(join(PUBLIC_BRANDS, file), 'utf8');
      expect(svg).not.toMatch(/<script|\son[a-z]+\s*=|javascript:|<foreignObject/i);
      expect(svg).not.toMatch(/(?:href|src)\s*=\s*["']https?:/i);
    }
  });
});
