import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { BrandService } from './core/brand.service';
import { SiteFooterComponent } from './layout/site-footer.component';
import { SiteHeaderComponent } from './layout/site-header.component';

@Component({
  selector: 'rs-root',
  imports: [RouterOutlet, SiteHeaderComponent, SiteFooterComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <rs-site-header [marca]="brand.brand.nombre" />
    <main id="contenido"><router-outlet /></main>
    <rs-site-footer [marca]="brand.brand.nombre" />
  `,
})
export class App {
  protected readonly brand = inject(BrandService);
}
