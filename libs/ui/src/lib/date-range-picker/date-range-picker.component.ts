import {
  booleanAttribute,
  ChangeDetectionStrategy,
  Component,
  computed,
  afterNextRender,
  effect,
  ElementRef,
  inject,
  Injector,
  input,
  model,
  signal,
  untracked,
} from '@angular/core';
import { IconComponent } from '../icon/icon.component';
import { IconName } from '../icon/icons';
import {
  CalendarDay,
  DateRangePreset,
  DateRangeValue,
  EMPTY_DATE_RANGE,
  formatRange,
  localIso,
  MONTH_NAMES,
  monthGrid,
  parseIso,
  pickDay,
  presetRange,
  WEEKDAY_NAMES,
} from './date-range';

let nextPickerId = 0;

/** Size of the panel before it is measured, and its distance to the viewport edge and to the field. */
const ESTIMATED_WIDTH = 480;
const ESTIMATED_HEIGHT = 340;
const VIEWPORT_MARGIN = 8;
const PANEL_GAP = 4;

/**
 * Figma: DateRangePicker (Open = Closed | Open).
 * A field that opens a panel with the quick ranges (last week / month / year / custom) beside a month
 * calendar and an "Aplicar" button. Days are `YYYY-MM-DD` strings; the range only changes on "Aplicar".
 *
 *   <rs-date-range-picker placeholder="Fecha" ariaLabel="Fecha" [(value)]="range" />
 *
 * Keyboard: the days are buttons (Tab / Enter / Space); Escape closes without applying.
 */
@Component({
  selector: 'rs-date-range-picker',
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.rs-date-range-picker--open]': 'open()',
    '(document:click)': 'onDocumentClick($event)',
    '(keydown.escape)': 'onEscape($event)',
  },
  templateUrl: './date-range-picker.component.html',
  styleUrl: './date-range-picker.component.scss',
})
export class DateRangePickerComponent {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  /** Applied range (two-way). */
  readonly value = model<DateRangeValue>(EMPTY_DATE_RANGE);
  /** Panel open (two-way), so the showcase can render it statically. */
  readonly open = model(false);
  readonly placeholder = input('');
  readonly leadingIcon = input<IconName>('calendar');
  readonly disabled = input(false, { transform: booleanAttribute });
  readonly inputId = input<string>(`rs-date-range-${nextPickerId++}`);
  readonly ariaLabel = input('');
  /** The day the quick ranges count from; defaults to the browser's today. */
  readonly today = input<string | null>(null);
  /** Visible texts, Spanish by default. */
  readonly applyLabel = input('Aplicar');
  readonly previousMonthLabel = input('Mes anterior');
  readonly nextMonthLabel = input('Mes siguiente');
  readonly presetLabels = input({
    'last-week': 'Semana pasada',
    'last-month': 'Mes pasado',
    'last-year': 'Año pasado',
    custom: 'Personalizado',
  });

  protected readonly panelId = `rs-date-range-panel-${nextPickerId++}`;
  protected readonly weekdays = WEEKDAY_NAMES;
  protected readonly presets: readonly (DateRangePreset | 'custom')[] = ['last-week', 'last-month', 'last-year', 'custom'];

  /** What the panel shows before "Aplicar". */
  protected readonly draft = signal<DateRangeValue>(EMPTY_DATE_RANGE);
  protected readonly activePreset = signal<DateRangePreset | 'custom'>('custom');
  private readonly view = signal<{ year: number; month: number }>({ year: 1970, month: 0 });

  protected readonly todayIso = computed(() => this.today() ?? localIso(new Date()));
  protected readonly summary = computed(() => formatRange(this.value()));
  protected readonly monthTitle = computed(() => `${MONTH_NAMES[this.view().month]} ${this.view().year}`);
  protected readonly weeks = computed<CalendarDay[][]>(() => monthGrid(this.view().year, this.view().month));
  protected readonly canApply = computed(() => !!this.draft().from);

  /** Position of the panel in viewport pixels: under the field when it fits, over it when not, and never off the screen. */
  protected readonly panelStyle = signal<Record<string, string>>({});
  private stopFollowing: () => void = () => undefined;

  constructor() {
    effect(() => {
      if (!this.open()) {
        this.stopFollowing();
        return;
      }
      untracked(() => {
        this.placePanel();
        // measured once it is drawn, so a panel narrower or wider than the estimate still ends inside the screen
        afterNextRender(() => this.placePanel(), { injector: this.injector });
        this.followPage();
      });
    });
  }

  private placePanel(): void {
    const el = this.host.nativeElement;
    const view = el.ownerDocument.defaultView;
    if (!view) return;
    const field = el.getBoundingClientRect();
    const panel = el.querySelector<HTMLElement>('.panel');
    const width = panel?.offsetWidth || ESTIMATED_WIDTH;
    const height = panel?.offsetHeight || ESTIMATED_HEIGHT;
    const left = Math.max(VIEWPORT_MARGIN, Math.min(field.left, view.innerWidth - width - VIEWPORT_MARGIN));
    const below = view.innerHeight - field.bottom - VIEWPORT_MARGIN;
    const above = field.top - VIEWPORT_MARGIN;
    const top = height > below && above > below ? Math.max(VIEWPORT_MARGIN, field.top - height - PANEL_GAP) : field.bottom + PANEL_GAP;
    this.panelStyle.set({ left: `${left}px`, top: `${top}px` });
  }

  /** The panel is fixed to the viewport, so it closes when the page scrolls or resizes instead of floating away from its field. */
  private followPage(): void {
    this.stopFollowing();
    const view = this.host.nativeElement.ownerDocument.defaultView;
    const onMove = (event: Event) => {
      if (event.target instanceof Node && this.host.nativeElement.contains(event.target)) return;
      this.open.set(false);
    };
    view?.addEventListener('scroll', onMove, true);
    view?.addEventListener('resize', onMove);
    this.stopFollowing = () => {
      view?.removeEventListener('scroll', onMove, true);
      view?.removeEventListener('resize', onMove);
      this.stopFollowing = () => undefined;
    };
  }

  protected toggle(): void {
    if (this.disabled()) return;
    if (this.open()) this.open.set(false);
    else this.show();
  }

  private show(): void {
    const applied = this.value();
    this.draft.set(applied);
    this.activePreset.set('custom');
    this.showMonthOf(applied.from ?? this.todayIso());
    this.open.set(true);
  }

  private showMonthOf(iso: string): void {
    const [year, month] = parseIso(iso) ?? parseIso(this.todayIso()) ?? [1970, 0];
    this.view.set({ year, month });
  }

  protected moveMonth(step: -1 | 1): void {
    const { year, month } = this.view();
    const next = new Date(Date.UTC(year, month + step, 1));
    this.view.set({ year: next.getUTCFullYear(), month: next.getUTCMonth() });
  }

  protected choosePreset(preset: DateRangePreset | 'custom'): void {
    this.activePreset.set(preset);
    if (preset === 'custom') {
      this.draft.set(EMPTY_DATE_RANGE);
      return;
    }
    const range = presetRange(preset, this.todayIso());
    this.draft.set(range);
    if (range.from) this.showMonthOf(range.from);
  }

  protected chooseDay(iso: string): void {
    this.activePreset.set('custom');
    this.draft.set(pickDay(this.draft(), iso));
  }

  protected apply(): void {
    if (!this.canApply()) return;
    const { from, to } = this.draft();
    this.value.set({ from, to: to ?? from });
    this.open.set(false);
  }

  /** The state of a day against the draft: whether it is inside the range and whether it ends it. */
  protected dayState(day: CalendarDay): { inRange: boolean; edge: boolean } {
    const { from, to } = this.draft();
    const end = to ?? from;
    const inRange = !!from && !!end && day.iso >= from && day.iso <= end;
    return { inRange, edge: inRange && (day.iso === from || day.iso === end) };
  }

  /** "15 de octubre de 2023", the accessible name of a day. */
  protected dayLabel(day: CalendarDay): string {
    const [year, month] = parseIso(day.iso) ?? [0, 0];
    return `${day.day} de ${MONTH_NAMES[month].toLowerCase()} de ${year}`;
  }

  protected onDocumentClick(event: Event): void {
    if (this.open() && !this.host.nativeElement.contains(event.target as Node)) this.open.set(false);
  }

  protected onEscape(event: Event): void {
    if (!this.open()) return;
    event.stopPropagation();
    this.open.set(false);
  }
}
