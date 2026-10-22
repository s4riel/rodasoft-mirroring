import { DOCUMENT } from '@angular/common';
import { inject, Injectable, REQUEST } from '@angular/core';
import type { BrandMode } from '@rodasoft/domain';

interface BrandInfo {
  mode: BrandMode;
  name: string;
}

/**
 * Hosts of each brand. Adjust with the final domains (Phase 0).
 * In development: http://rodalaser.localhost:4300 and http://company2.localhost:4300
 */
const BRANDS: { match: RegExp; brand: BrandInfo }[] = [
  { match: /(^|\.)company2\./i, brand: { mode: 'company2', name: 'Empresa 2' } },
];
const DEFAULT_BRAND: BrandInfo = { mode: 'rodalaser', name: 'Rodalaser' };

@Injectable({ providedIn: 'root' })
export class BrandService {
  private readonly document = inject(DOCUMENT);
  private readonly request = inject(REQUEST, { optional: true });

  readonly brand: BrandInfo = this.resolve();

  constructor() {
    // on the server and in the browser, so the hydrated HTML already has the right colors
    this.document.documentElement.setAttribute('data-brand', this.brand.mode);
  }

  private resolve(): BrandInfo {
    const host = this.request ? (this.request.headers.get('host') ?? '') : this.document.location?.hostname ?? '';
    return BRANDS.find((b) => b.match.test(host))?.brand ?? DEFAULT_BRAND;
  }
}
