import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { BearingDiagramComponent } from './bearing-diagram.component';

@Component({
  imports: [BearingDiagramComponent],
  template: `<rs-bearing-diagram outerDiameter="52" innerDiameter="25" />`,
})
class HostComponent {}

describe('BearingDiagramComponent', () => {
  async function render() {
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    return fixture.nativeElement.querySelector('rs-bearing-diagram') as HTMLElement;
  }

  it('draws the outer and the inner ring', async () => {
    const diagram = await render();
    expect(diagram.querySelectorAll('circle')).toHaveLength(2);
  });

  it('writes D and d with the given measurements', async () => {
    const labels = Array.from((await render()).querySelectorAll('text')).map((t) => t.textContent?.trim());
    expect(labels).toEqual(['D 52', 'd 25']);
  });

  it('is decorative for assistive technology', async () => {
    expect((await render()).getAttribute('aria-hidden')).toBe('true');
  });
});
