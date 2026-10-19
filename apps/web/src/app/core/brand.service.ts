import { DOCUMENT } from '@angular/common';
import { inject, Injectable, REQUEST } from '@angular/core';
import type { BrandMode } from '@rodasoft/domain';

interface BrandInfo {
  mode: BrandMode;
  nombre: string;
}

/**
 * Hosts de cada marca. Ajustar con los dominios definitivos (Fase 0).
 * En desarrollo: http://rodalaser.localhost:4300 y http://empresa2.localhost:4300
 */
const BRANDS: { match: RegExp; brand: BrandInfo }[] = [
  { match: /(^|\.)empresa2\./i, brand: { mode: 'empresa2', nombre: 'Empresa 2' } },
];
const DEFAULT_BRAND: BrandInfo = { mode: 'rodalaser', nombre: 'Rodalaser' };

@Injectable({ providedIn: 'root' })
export class BrandService {
  private readonly document = inject(DOCUMENT);
  private readonly request = inject(REQUEST, { optional: true });

  readonly brand: BrandInfo = this.resolve();

  constructor() {
    // en el servidor y en el navegador, para que el HTML hidratado ya tenga los colores correctos
    this.document.documentElement.setAttribute('data-brand', this.brand.mode);
  }

  private resolve(): BrandInfo {
    const host = this.request ? (this.request.headers.get('host') ?? '') : this.document.location?.hostname ?? '';
    return BRANDS.find((b) => b.match.test(host))?.brand ?? DEFAULT_BRAND;
  }
}
