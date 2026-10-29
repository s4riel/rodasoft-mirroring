import {
  booleanAttribute,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  input,
  model,
  signal,
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
