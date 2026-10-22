import { ChangeDetectionStrategy, Component, input } from '@angular/core';

@Component({
  selector: 'rs-section-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="rs-container">
      <p class="rs-eyebrow">En construcción</p>
      <h1>{{ title() }}</h1>
      <p class="muted">{{ delivery() }}</p>
    </section>
  `,
  styles: `
    section { padding: var(--space-16) 0; display: grid; gap: var(--space-3); }
    h1 { font-size: var(--text-display-xl); }
    .muted { color: var(--text-muted); }
  `,
})
export class SectionPage {
  readonly title = input('Sección');
  readonly delivery = input('');
}
