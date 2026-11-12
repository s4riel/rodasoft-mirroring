import { TestBed } from '@angular/core/testing';
import { creditDueDate, formatDayShort, laPazToday, type PosCreditInfo } from '@rodasoft/domain';
import { PosCreditPanel } from './pos-credit-panel';

const info: PosCreditInfo = { available: true, reason: null, termOptions: [5, 15, 30] };

describe('PosCreditPanel', () => {
  function render(over: { busy?: boolean; info?: PosCreditInfo } = {}) {
    const fixture = TestBed.createComponent(PosCreditPanel);
    fixture.componentRef.setInput('total', '1111.00');
    fixture.componentRef.setInput('info', over.info ?? info);
    fixture.componentRef.setInput('customerName', 'Constructora Andina');
    fixture.componentRef.setInput('busy', over.busy ?? false);
    const confirmed = jest.fn();
    fixture.componentInstance.confirmed.subscribe(confirmed);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const chip = (label: string) =>
      Array.from(root.querySelectorAll<HTMLButtonElement>('rs-filter-chip button')).find((b) => b.textContent?.trim() === label)!;
    const text = (testId: string) => root.querySelector(`[data-testid=${testId}]`)?.textContent?.trim();
    return { fixture, root, confirmed, chip, text };
  }

  it('offers the terms it is given plus "Otro", and none is picked at first', () => {
    const { fixture, root, chip, text } = render({ info: { ...info, termOptions: [7, 45] } });
    expect(Array.from(root.querySelectorAll('.chips rs-filter-chip')).map((c) => c.textContent?.trim())).toEqual(['7 días', '45 días', 'Otro']);
    expect(chip('7 días').getAttribute('aria-pressed')).toBe('false');
    expect(text('credit-due')).toBe('—');
    expect(fixture.componentInstance.canSubmit()).toBe(false);
  });

  it('shows the customer, the flag, no limit and the balance', () => {
    const { root, text } = render();
    expect(text('credit-customer')).toBe('Constructora Andina');
    expect(text('credit-balance')).toBe('Bs 1.111,00');
    expect(root.textContent).toContain('Habilitado en su ficha');
    expect(root.textContent).toContain('Sin límite');
    expect(root.textContent).toContain('El crédito es una marca en la ficha del cliente.');
  });

  it('writes the due date of the picked term and emits the days when submitted', () => {
    const { fixture, chip, text, confirmed } = render();
    chip('15 días').click();
    fixture.detectChanges();
    expect(text('credit-due')).toBe(formatDayShort(creditDueDate(laPazToday(new Date()), 15)));
    expect(fixture.componentInstance.termDays()).toBe(15);
    expect(fixture.componentInstance.canSubmit()).toBe(true);
    fixture.componentInstance.submit();
    expect(confirmed).toHaveBeenCalledWith(15);
  });

  it('keeps the term when the picked chip is pressed again', () => {
    const { fixture, chip } = render();
    chip('5 días').click();
    fixture.detectChanges();
    chip('5 días').click();
    fixture.detectChanges();
    expect(fixture.componentInstance.termDays()).toBe(5);
  });

  it('takes the days typed in "Otro" and refuses 0, fractions and more than a year', () => {
    const { fixture, root, chip, confirmed } = render();
    chip('Otro').click();
    fixture.detectChanges();
    const input = root.querySelector<HTMLInputElement>('#credit-days')!;
    const type = (value: string) => {
      input.value = value;
      input.dispatchEvent(new Event('input'));
      fixture.detectChanges();
    };
    for (const bad of ['0', '366', '1,5', 'abc']) {
      type(bad);
      expect(fixture.componentInstance.termDays()).toBeNull();
      expect(fixture.componentInstance.canSubmit()).toBe(false);
    }
    expect(root.textContent).toContain('Escribe de 1 a 365 días.');
    type('45');
    expect(root.textContent).not.toContain('Escribe de 1 a 365 días.');
    fixture.componentInstance.submit();
    expect(confirmed).toHaveBeenCalledWith(45);
  });

  it('does not submit without a term, or while the sale is being saved', () => {
    const idle = render();
    idle.fixture.componentInstance.submit();
    expect(idle.confirmed).not.toHaveBeenCalled();
    TestBed.resetTestingModule();
    const busy = render({ busy: true });
    busy.chip('30 días').click();
    busy.fixture.detectChanges();
    busy.fixture.componentInstance.submit();
    expect(busy.confirmed).not.toHaveBeenCalled();
  });

  it('Enter on a term chip leaves the chip to its button instead of confirming', () => {
    const { fixture, chip, confirmed } = render();
    chip('30 días').click();
    fixture.detectChanges();
    const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    chip('15 días').dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(confirmed).not.toHaveBeenCalled();
  });

  it('Enter submits the picked term', () => {
    const { fixture, root, chip, confirmed } = render();
    chip('30 días').click();
    fixture.detectChanges();
    root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(confirmed).toHaveBeenCalledWith(30);
  });
});
