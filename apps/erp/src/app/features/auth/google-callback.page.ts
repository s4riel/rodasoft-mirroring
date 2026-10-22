import { ChangeDetectionStrategy, Component, inject, input, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { problemOf } from '../../core/api-error';
import { AuthService } from '../../core/auth/auth.service';

/** Landing after Google: exchanges the one-time code for the ERP session. */
@Component({
  selector: 'rs-google-callback-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<p class="wait rs-muted" role="status">Ingresando…</p>`,
  styles: `.wait { display: grid; place-items: center; min-height: 100vh; }`,
})
export class GoogleCallbackPage implements OnInit {
  readonly code = input<string>('');
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  async ngOnInit() {
    try {
      await this.auth.exchangeGoogleCode(this.code());
      await this.router.navigateByUrl('/', { replaceUrl: true });
    } catch (e) {
      await this.router.navigate(['/login'], { queryParams: { error: problemOf(e).code }, replaceUrl: true });
    }
  }
}
