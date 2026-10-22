import { ChangeDetectionStrategy, Component } from '@angular/core';
import {
  ButtonComponent,
  ButtonSize,
  ButtonVariant,
  CheckboxComponent,
  FieldComponent,
  IconButtonComponent,
  IconButtonSize,
  IconComponent,
  InputDirective,
  InputGroupComponent,
  RadioComponent,
  RadioGroupComponent,
  SelectComponent,
  SelectOption,
  SwitchComponent,
  TextareaDirective,
} from '@rodasoft/ui';

/**
 * Design-system showcase: group "Actions & forms" (Figma page 02 Base Components).
 * Same grouping as the Figma frames. Hover / Pressed / Focus are real pseudo-classes: hover or tab onto any control.
 */
@Component({
  selector: 'rs-actions-forms-section',
  imports: [
    ButtonComponent,
    IconButtonComponent,
    IconComponent,
    InputDirective,
    InputGroupComponent,
    TextareaDirective,
    SelectComponent,
    FieldComponent,
    CheckboxComponent,
    RadioGroupComponent,
    RadioComponent,
    SwitchComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2>Acciones y formularios</h2>
    <p class="rs-muted note">
      Los estados Hover, Pressed y Focus son pseudo-clases CSS: pasa el cursor, presiona o navega con Tab sobre cada
      control para verlos.
    </p>

    <!-- Button/Content: Size x Icon -->
    <section>
      <h3>Button / Content (tamaño × ícono)</h3>
      <div class="row">
        @for (size of sizes; track size) {
          <button rsButton variant="secondary" [size]="size">Cotizar</button>
          <button rsButton variant="secondary" [size]="size">
            <rs-icon name="plus" [size]="16" />
            Cotizar
          </button>
          <button rsButton variant="secondary" [size]="size">
            Cotizar
            <rs-icon name="arrow" [size]="16" />
          </button>
        }
      </div>
    </section>

    <!-- Button: Variant x State -->
    <section>
      <h3>Button (variante × estado)</h3>
      <div class="grid-states">
        <span class="rs-eyebrow">Variante</span>
        <span class="rs-eyebrow">Default</span>
        <span class="rs-eyebrow">Deshabilitado</span>
        <span class="rs-eyebrow">Cargando</span>
        <span class="rs-eyebrow">Con íconos</span>
        @for (variant of variants; track variant) {
          <span class="rs-mono">{{ variant }}</span>
          <div><button rsButton [variant]="variant">Cotizar</button></div>
          <div><button rsButton [variant]="variant" disabled>Cotizar</button></div>
          <div><button rsButton [variant]="variant" loading>Cotizar</button></div>
          <div class="row">
            <button rsButton [variant]="variant">
              <rs-icon name="plus" [size]="16" />
              Agregar
            </button>
            <button rsButton [variant]="variant">
              Siguiente
              <rs-icon name="arrow" [size]="16" />
            </button>
          </div>
        }
      </div>
      <h4>Enlace y ancho completo</h4>
      <div class="stack narrow">
        <a rsButton variant="secondary" size="lg" fill href="#">Continuar con Google</a>
        <button rsButton size="lg" fill>Ingresar</button>
      </div>
    </section>

    <!-- IconButton -->
    <section>
      <h3>IconButton (tamaño × estado)</h3>
      <div class="row">
        @for (size of iconSizes; track size) {
          <button rsIconButton label="Buscar" [size]="size"><rs-icon name="search" /></button>
          <button rsIconButton label="Buscar" [size]="size" disabled><rs-icon name="search" /></button>
        }
      </div>
    </section>

    <!-- Input -->
    <section>
      <h3>Input</h3>
      <div class="cols">
        <label class="cap">Default<input rsInput value="6205-2RS" aria-label="Default" /></label>
        <label class="cap">Placeholder<input rsInput placeholder="Código" aria-label="Placeholder" /></label>
        <label class="cap">Error<input rsInput invalid value="6205-2RS" aria-label="Error" /></label>
        <label class="cap">Deshabilitado<input rsInput disabled value="6205-2RS" aria-label="Deshabilitado" /></label>
        <div class="cap">
          Ícono inicial
          <rs-input-group>
            <rs-icon rsInputLeading name="search" [size]="16" />
            <input rsInput value="6205-2RS" aria-label="Con ícono inicial" />
          </rs-input-group>
        </div>
        <div class="cap">
          Ícono final
          <rs-input-group>
            <input rsInput value="6205-2RS" aria-label="Con ícono final" />
            <rs-icon rsInputTrailing name="eye" [size]="16" />
          </rs-input-group>
        </div>
        <div class="cap">
          Ícono inicial + error
          <rs-input-group invalid>
            <rs-icon rsInputLeading name="search" [size]="16" />
            <input rsInput value="6205-2RS" aria-label="Con ícono y error" />
          </rs-input-group>
        </div>
        <div class="cap">
          Ícono inicial + deshabilitado
          <rs-input-group>
            <rs-icon rsInputLeading name="search" [size]="16" />
            <input rsInput disabled value="6205-2RS" aria-label="Con ícono deshabilitado" />
          </rs-input-group>
        </div>
      </div>
    </section>

    <!-- Select: State x Open -->
    <section>
      <h3>Select (cerrado / abierto)</h3>
      <div class="cols select-cols">
        <div class="cap">
          Default · cerrado
          <rs-select [options]="branches" [value]="'central'" ariaLabel="Sucursal" />
        </div>
        <div class="cap tall">
          Default · abierto
          <rs-select [options]="branches" [value]="'central'" [open]="true" ariaLabel="Sucursal abierta" />
        </div>
        <div class="cap">
          Placeholder
          <rs-select [options]="branches" placeholder="Selecciona una sucursal" ariaLabel="Sucursal sin valor" />
        </div>
        <div class="cap">
          Con ícono inicial
          <rs-select [options]="branches" [value]="'norte'" leadingIcon="search" ariaLabel="Sucursal con ícono" />
        </div>
        <div class="cap">
          Error
          <rs-select [options]="branches" [value]="'central'" invalid ariaLabel="Sucursal con error" />
        </div>
        <div class="cap tall">
          Error · abierto
          <rs-select [options]="branches" [value]="'central'" invalid [open]="true" ariaLabel="Sucursal error abierta" />
        </div>
        <div class="cap">
          Deshabilitado
          <rs-select [options]="branches" [value]="'central'" disabled ariaLabel="Sucursal deshabilitada" />
        </div>
      </div>
    </section>

    <!-- Textarea -->
    <section>
      <h3>Textarea</h3>
      <div class="cols wide">
        <label class="cap">
          Default
          <textarea rsTextarea rows="3" aria-label="Default" [value]="longNote"></textarea>
        </label>
        <label class="cap">
          Error
          <textarea rsTextarea rows="3" invalid aria-label="Error" [value]="shortNote"></textarea>
        </label>
        <label class="cap">
          Deshabilitado
          <textarea rsTextarea rows="3" disabled aria-label="Deshabilitado" [value]="shortNote"></textarea>
        </label>
      </div>
    </section>

    <!-- Field: Control x State -->
    <section>
      <h3>Field (control × estado)</h3>
      <div class="cols">
        <rs-field label="Código de rodamiento" forId="f-input" hint="Ingresa la referencia del fabricante.">
          <input rsInput id="f-input" value="6205-2RS" />
        </rs-field>
        <rs-field
          label="Código de rodamiento"
          forId="f-input-req"
          hint="Ingresa la referencia del fabricante."
          required
        >
          <input rsInput id="f-input-req" placeholder="Código" required />
        </rs-field>
        <rs-field
          label="Código de rodamiento"
          forId="f-input-err"
          error="No pudimos validar el valor. Revisa la información."
        >
          <input rsInput id="f-input-err" value="6205-2RS" />
        </rs-field>
        <rs-field label="Código de rodamiento" forId="f-input-dis" hint="Campo bloqueado.">
          <input rsInput id="f-input-dis" value="6205-2RS" disabled />
        </rs-field>

        <rs-field label="Sucursal" forId="f-select" hint="Elige la sucursal de entrega.">
          <rs-select inputId="f-select" [options]="branches" [value]="'central'" />
        </rs-field>
        <rs-field label="Sucursal" forId="f-select-err" error="Selecciona una sucursal disponible.">
          <rs-select inputId="f-select-err" [options]="branches" [value]="'central'" />
        </rs-field>
        <rs-field label="Sucursal" forId="f-select-dis" hint="Campo bloqueado.">
          <rs-select inputId="f-select-dis" [options]="branches" [value]="'central'" disabled />
        </rs-field>
      </div>
      <div class="cols wide">
        <rs-field label="Comentarios" forId="f-area" hint="Indica cantidades y plazo.">
          <textarea rsTextarea id="f-area" rows="3" [value]="shortNote"></textarea>
        </rs-field>
        <rs-field label="Comentarios" forId="f-area-err" error="El comentario es muy corto.">
          <textarea rsTextarea id="f-area-err" rows="3" value="Hola"></textarea>
        </rs-field>
        <rs-field label="Comentarios" forId="f-area-dis" hint="Campo bloqueado.">
          <textarea rsTextarea id="f-area-dis" rows="3" disabled [value]="shortNote"></textarea>
        </rs-field>
      </div>
    </section>

    <!-- Checkbox -->
    <section>
      <h3>Checkbox (marcado × estado)</h3>
      <div class="row">
        <rs-checkbox [checked]="true">Incluir ficha técnica</rs-checkbox>
        <rs-checkbox>Incluir ficha técnica</rs-checkbox>
        <rs-checkbox [checked]="true" disabled>Incluir ficha técnica</rs-checkbox>
        <rs-checkbox disabled>Incluir ficha técnica</rs-checkbox>
        <rs-checkbox invalid>Acepto los términos</rs-checkbox>
      </div>
    </section>

    <!-- Radio -->
    <section>
      <h3>Radio</h3>
      <div class="row">
        <rs-radio-group ariaLabel="Entrega" [value]="'pickup'">
          <rs-radio value="pickup">Retiro en sucursal</rs-radio>
          <rs-radio value="delivery">Envío a domicilio</rs-radio>
          <rs-radio value="courier" disabled>Mensajería (no disponible)</rs-radio>
        </rs-radio-group>
        <rs-radio-group ariaLabel="Entrega horizontal" orientation="horizontal" [value]="'delivery'">
          <rs-radio value="pickup">Retiro en sucursal</rs-radio>
          <rs-radio value="delivery">Envío a domicilio</rs-radio>
        </rs-radio-group>
        <rs-radio-group ariaLabel="Grupo deshabilitado" disabled [value]="'pickup'">
          <rs-radio value="pickup">Retiro en sucursal</rs-radio>
          <rs-radio value="delivery">Envío a domicilio</rs-radio>
        </rs-radio-group>
      </div>
    </section>

    <!-- Switch -->
    <section>
      <h3>Switch (activado × estado)</h3>
      <div class="row">
        <rs-switch [checked]="true" onText="Activado" offText="Desactivado">Solo disponibles</rs-switch>
        <rs-switch onText="Activado" offText="Desactivado">Solo disponibles</rs-switch>
        <rs-switch [checked]="true" disabled onText="Activado" offText="Desactivado">Solo disponibles</rs-switch>
        <rs-switch disabled onText="Activado" offText="Desactivado">Solo disponibles</rs-switch>
      </div>
    </section>
  `,
  styles: `
    :host {
      display: block;
    }
    section {
      display: grid;
      gap: var(--space-4);
      margin-top: var(--space-8);
    }
    .note {
      margin-top: var(--space-2);
    }
    .row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-4) var(--space-6);
    }
    .cols {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 320px));
      gap: var(--space-6);
      align-items: start;
    }
    .cols.wide {
      grid-template-columns: repeat(auto-fill, minmax(280px, 400px));
    }
    .select-cols .tall {
      min-height: 190px; /* room for the open option panel (absolute overlay) */
    }
    .cap {
      display: grid;
      gap: var(--space-2);
      color: var(--text-muted);
      font-size: var(--body-sm-size);
      line-height: var(--body-sm-line-height);
      align-content: start;
    }
    .grid-states {
      display: grid;
      grid-template-columns: 96px repeat(3, max-content) 1fr;
      gap: var(--space-3) var(--space-6);
      align-items: center;
    }
    .stack {
      display: grid;
      gap: var(--space-3);
    }
    .narrow {
      max-width: 320px;
    }
  `,
})
export class ActionsFormsSection {
  protected readonly sizes: readonly ButtonSize[] = ['sm', 'md', 'lg'];
  protected readonly iconSizes: readonly IconButtonSize[] = ['sm', 'md', 'lg'];
  protected readonly variants: readonly ButtonVariant[] = ['primary', 'secondary', 'ghost', 'brand', 'danger'];
  protected readonly longNote =
    'Necesito 12 unidades del rodamiento 6205-2RS.\nConfirmar disponibilidad y plazo de entrega\nen la sucursal central.';
  protected readonly shortNote = 'Necesito 12 unidades del rodamiento 6205-2RS.';
  protected readonly branches: SelectOption<string>[] = [
    { value: 'central', label: 'Sucursal central' },
    { value: 'norte', label: 'Sucursal norte' },
    { value: 'sur', label: 'Sucursal sur' },
  ];
}
