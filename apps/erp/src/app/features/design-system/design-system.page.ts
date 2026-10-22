import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { ButtonComponent } from '@rodasoft/ui';
import { ActionsFormsSection } from './sections/actions-forms.section';
import { IconsSection } from './sections/icons.section';
import { NavigationContentSection } from './sections/navigation-content.section';
import { SelectionFeedbackSection } from './sections/selection-feedback.section';

type SectionKey = 'actions' | 'selection' | 'navigation' | 'icons';
type Theme = 'light' | 'dark';
type Brand = 'rodalaser' | 'company2';

/**
 * Component catalog (dev only, route /design-system). Renders every `@rodasoft/ui` component with its
 * variants and static states so it can be compared side by side with the Figma frames, in the 2 x 2 matrix of
 * Color (light/dark) × Brand (rodalaser/company2) modes.
 */
@Component({
  selector: 'rs-design-system-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ButtonComponent, ActionsFormsSection, SelectionFeedbackSection, NavigationContentSection, IconsSection],
  template: `
    <header class="bar">
      <h1 class="rs-text-display-h3">Librería UI · Design System</h1>
      <nav class="group" aria-label="Secciones">
        @for (s of sections; track s.key) {
          <button rsButton size="sm" [variant]="section() === s.key ? 'primary' : 'secondary'" (click)="section.set(s.key)">
            {{ s.label }}
          </button>
        }
      </nav>
      <div class="group" role="group" aria-label="Modo">
        <button rsButton size="sm" [variant]="theme() === 'light' ? 'primary' : 'secondary'" (click)="setTheme('light')">Claro</button>
        <button rsButton size="sm" [variant]="theme() === 'dark' ? 'primary' : 'secondary'" (click)="setTheme('dark')">Oscuro</button>
        <button rsButton size="sm" [variant]="brand() === 'rodalaser' ? 'primary' : 'secondary'" (click)="setBrand('rodalaser')">Empresa 1</button>
        <button rsButton size="sm" [variant]="brand() === 'company2' ? 'primary' : 'secondary'" (click)="setBrand('company2')">Empresa 2</button>
      </div>
    </header>
    <main class="body">
      @switch (section()) {
        @case ('actions') { <rs-actions-forms-section /> }
        @case ('selection') { <rs-selection-feedback-section /> }
        @case ('navigation') { <rs-navigation-content-section /> }
        @case ('icons') { <rs-icons-section /> }
      }
    </main>
  `,
  styles: `
    :host { display: block; min-height: 100vh; background: var(--bg-page); color: var(--text-primary); }
    .bar {
      position: sticky; top: 0; z-index: 10; display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-4);
      padding: var(--space-3) var(--space-8); background: var(--bg-surface); border-bottom: var(--stroke-default) solid var(--border-default);
    }
    .bar h1 { margin-right: auto; }
    .group { display: flex; flex-wrap: wrap; gap: var(--space-2); }
    .body { padding: var(--space-8); max-width: var(--content-max); margin: 0 auto; }
  `,
})
export class DesignSystemPage {
  private readonly root = inject(DOCUMENT).documentElement;

  protected readonly sections: { key: SectionKey; label: string }[] = [
    { key: 'actions', label: 'Acciones y formularios' },
    { key: 'selection', label: 'Selección y feedback' },
    { key: 'navigation', label: 'Navegación y contenido' },
    { key: 'icons', label: 'Íconos' },
  ];
  protected readonly section = signal<SectionKey>('actions');
  protected readonly theme = signal<Theme>((this.root.dataset['theme'] as Theme) ?? 'light');
  protected readonly brand = signal<Brand>((this.root.dataset['brand'] as Brand) ?? 'rodalaser');

  protected setTheme(theme: Theme) {
    this.theme.set(theme);
    this.root.dataset['theme'] = theme;
  }

  protected setBrand(brand: Brand) {
    this.brand.set(brand);
    this.root.dataset['brand'] = brand;
  }
}
