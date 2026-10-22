import { TestBed } from '@angular/core/testing';
import { buildPageList, PaginationComponent } from './pagination.component';

describe('buildPageList', () => {
  it('lists all pages when there are 7 or fewer', () => {
    expect(buildPageList(1, 5)).toEqual([1, 2, 3, 4, 5]);
  });
  it('collapses far pages into ellipses', () => {
    expect(buildPageList(1, 20)).toEqual([1, 2, 3, 4, null, 20]);
    expect(buildPageList(10, 20)).toEqual([1, null, 9, 10, 11, null, 20]);
    expect(buildPageList(20, 20)).toEqual([1, null, 17, 18, 19, 20]);
  });
});

describe('PaginationComponent', () => {
  function setup(page: number, pageCount: number) {
    const fixture = TestBed.createComponent(PaginationComponent);
    fixture.componentRef.setInput('page', page);
    fixture.componentRef.setInput('pageCount', pageCount);
    return fixture;
  }

  it('marks the current page and disables previous on the first page', async () => {
    const fixture = setup(1, 5);
    await fixture.whenStable();
    const buttons: HTMLButtonElement[] = Array.from(fixture.nativeElement.querySelectorAll('button'));
    expect(buttons.length).toBe(7);
    expect(buttons[0].disabled).toBe(true);
    expect(buttons[1].getAttribute('aria-current')).toBe('page');
    expect(buttons[6].disabled).toBe(false);
  });

  it('goes to the next page and to a clicked page', async () => {
    const fixture = setup(2, 5);
    await fixture.whenStable();
    const buttons: HTMLButtonElement[] = Array.from(fixture.nativeElement.querySelectorAll('button'));
    buttons[buttons.length - 1].click();
    await fixture.whenStable();
    expect(fixture.componentInstance.page()).toBe(3);
    const again: HTMLButtonElement[] = Array.from(fixture.nativeElement.querySelectorAll('button'));
    again[5].click();
    await fixture.whenStable();
    expect(fixture.componentInstance.page()).toBe(5);
  });
});
