import { DOCUMENT } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { inject, Injectable, signal } from '@angular/core';
import { BrandMode, companySlugFromHost } from '@rodasoft/domain';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';

interface PublicCompany {
  slug: string;
  tradeName: string;
  brand: BrandMode;
}

/**
 * Active company = URL subdomain (rodalaser.localhost, company2.erp.<domain>).
 * There is no company selector: to switch company, open the other URL.
 */
@Injectable({ providedIn: 'root' })
export class TenantService {
  private readonly http = inject(HttpClient);
  private readonly document = inject(DOCUMENT);

  readonly slug = companySlugFromHost(this.document.location.hostname) ?? environment.defaultCompany;
  readonly name = signal('Rodalaser');
  readonly brand = signal<BrandMode>('rodalaser');

  async init(): Promise<void> {
    try {
      const c = await firstValueFrom(this.http.get<PublicCompany>(`/api/v1/companies/${this.slug}/public`));
      this.name.set(c.tradeName);
      this.setBrand(c.brand);
    } catch {
      // API down or unknown company: show the default brand; the login screen will report the error
      this.setBrand(this.slug === 'company2' ? 'company2' : 'rodalaser');
    }
  }

  setBrand(brand: BrandMode) {
    this.brand.set(brand);
    this.document.documentElement.dataset['brand'] = brand;
  }
}
