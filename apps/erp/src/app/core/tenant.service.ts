import { DOCUMENT } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { inject, Injectable, signal } from '@angular/core';
import { BrandMode, empresaSlugFromHost } from '@rodasoft/domain';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';

interface EmpresaPublica {
  slug: string;
  nombreComercial: string;
  brand: BrandMode;
}

/**
 * Empresa activa = subdominio de la URL (rodalaser.localhost, empresa2.erp.<dominio>).
 * No hay selector de empresa: para cambiar de empresa se abre la otra URL.
 */
@Injectable({ providedIn: 'root' })
export class TenantService {
  private readonly http = inject(HttpClient);
  private readonly document = inject(DOCUMENT);

  readonly slug = empresaSlugFromHost(this.document.location.hostname) ?? environment.defaultEmpresa;
  readonly nombre = signal('Rodalaser');
  readonly brand = signal<BrandMode>('rodalaser');

  async init(): Promise<void> {
    try {
      const e = await firstValueFrom(this.http.get<EmpresaPublica>(`/api/v1/empresas/${this.slug}/publico`));
      this.nombre.set(e.nombreComercial);
      this.setBrand(e.brand);
    } catch {
      // API caída o empresa inexistente: se muestra la marca por defecto y el login informará el error
      this.setBrand(this.slug === 'empresa2' ? 'empresa2' : 'rodalaser');
    }
  }

  setBrand(brand: BrandMode) {
    this.brand.set(brand);
    this.document.documentElement.dataset['brand'] = brand;
  }
}
