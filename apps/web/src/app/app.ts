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
    <rs-site-header [brand]="brand.brand.name" />
    <main id="main-content"><router-outlet /></main>
    <rs-site-footer [brand]="brand.brand.name" />
  `,
})
export class App {
  protected readonly brand = inject(BrandService);
}
