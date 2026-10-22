import { ChangeDetectionStrategy, Component } from '@angular/core';
import { ICON_NAMES, IconComponent, IconName } from '@rodasoft/ui';

/** Derived or extra glyphs that are not part of the 62 Figma IconGlyph components. */
const EXTRA: readonly IconName[] = ['info', 'chevron-up', 'chevron-left', 'chevron-right'];

@Component({
  selector: 'rs-icons-section',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  template: `
    <section class="section">
      <h2 class="h">Íconos</h2>
      <p class="note">
        {{ figmaIcons.length }} glifos de la librería de Figma (IconLibrary), mostrados a 16, 20 y 24 px con trazo de
        1,8 y color del texto.
      </p>
      <div class="grid">
        @for (name of figmaIcons; track name) {
          <div class="cell">
            <div class="sizes">
              <rs-icon [name]="name" [size]="16" />
              <rs-icon [name]="name" [size]="20" />
              <rs-icon [name]="name" [size]="24" />
            </div>
            <code class="name">{{ name }}</code>
          </div>
        }
      </div>

      <h3 class="h3">Derivados y adicionales</h3>
      <p class="note">No existen en Figma como glifo propio: los chevrones giran el glifo ChevronDown e info replica el estilo de Ayuda.</p>
      <div class="grid">
        @for (name of extra; track name) {
          <div class="cell">
            <div class="sizes">
              <rs-icon [name]="name" [size]="16" />
              <rs-icon [name]="name" [size]="20" />
              <rs-icon [name]="name" [size]="24" />
            </div>
            <code class="name">{{ name }}</code>
          </div>
        }
      </div>
    </section>
  `,
  styles: `
    .section { display: flex; flex-direction: column; gap: var(--space-4); color: var(--text-primary); font-family: var(--font-family-ui); }
    .h, .h3 { margin: 0; }
    .note { margin: 0; color: var(--text-muted); }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: var(--space-3); }
    .cell {
      display: flex; flex-direction: column; align-items: center; gap: var(--space-2);
      padding: var(--space-4) var(--space-2); background: var(--bg-surface);
      border: 1px solid var(--border-default); border-radius: var(--radius-md);
    }
    .sizes { display: flex; align-items: center; gap: var(--space-3); }
    .name { color: var(--text-muted); font-size: 12px; /* caption size; no token for code labels */ }
  `,
})
export class IconsSection {
  protected readonly extra = EXTRA;
  protected readonly figmaIcons = ICON_NAMES.filter((n) => !EXTRA.includes(n));
}
