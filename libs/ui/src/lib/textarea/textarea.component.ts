import { AfterViewChecked, booleanAttribute, Directive, ElementRef, inject, input } from '@angular/core';

/**
 * Figma: Textarea (State = Default | Hover | Pressed | Focus | Error | Disabled). Native multi-line field.
 * Styles live in the global `.rs-textarea` class (`styles/_base.scss`). Value text is body/md (not mono).
 *   <textarea rsTextarea rows="3" formControlName="notes"></textarea>
 * With `autosize` the field grows with its text (and shrinks back), never below `rows`, and has no scrollbar or resize handle.
 * Inside `<rs-field>` the error state is applied automatically.
 */
@Directive({
  selector: 'textarea[rsTextarea]',
  host: {
    class: 'rs-textarea',
    '[attr.aria-invalid]': 'invalid() ? "true" : null',
    '[style.overflow-y]': 'autosize() ? "hidden" : null',
    '[style.resize]': 'autosize() ? "none" : null',
    '(input)': 'resize()',
  },
})
export class TextareaDirective implements AfterViewChecked {
  private readonly el = inject<ElementRef<HTMLTextAreaElement>>(ElementRef);
  private measured = '';

  /** Figma State=Error. */
  readonly invalid = input(false, { transform: booleanAttribute });
  /** Grows with the text instead of scrolling. */
  readonly autosize = input(false, { transform: booleanAttribute });

  /** A value set from code (a form patch) and a width change (the window) also need a new height. */
  ngAfterViewChecked(): void {
    this.resize();
  }

  protected resize(): void {
    if (!this.autosize()) return;
    const el = this.el.nativeElement;
    const signature = `${el.value}|${el.clientWidth}`;
    if (signature === this.measured) return;
    this.measured = signature;
    el.style.height = 'auto';
    // scrollHeight leaves out the border, which the box-sizing of the field counts
    el.style.height = `${el.scrollHeight + (el.offsetHeight - el.clientHeight)}px`;
  }
}
