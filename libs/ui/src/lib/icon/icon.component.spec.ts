import { TestBed } from '@angular/core/testing';
import { IconComponent } from './icon.component';
import { ICON_NAMES, ICONS, resolveIcon } from './icons';

describe('icons', () => {
  it('exposes the 62 Figma glyphs plus info and the 3 derived chevrons', () => {
    expect(Object.keys(ICONS)).toHaveLength(63);
    expect(ICON_NAMES).toHaveLength(66);
  });

  it.each(ICON_NAMES)('%s resolves to a non-empty definition', (name) => {
    const { def } = resolveIcon(name);
    const shapes = def.d.length + (def.circles?.length ?? 0) + (def.fills?.length ?? 0);
    expect(shapes).toBeGreaterThan(0);
    for (const p of [...def.d, ...(def.fills ?? [])]) expect(p.startsWith('M')).toBe(true);
  });

  it('derives chevrons by rotating chevron-down', () => {
    expect(resolveIcon('chevron-up').rotate).toBe(180);
    expect(resolveIcon('chevron-left').rotate).toBe(90);
    expect(resolveIcon('chevron-right').rotate).toBe(-90);
    expect(resolveIcon('chevron-right').def).toBe(ICONS['chevron-down']);
  });
});

describe('IconComponent', () => {
  it('renders paths and applies size, stroke and rotation', () => {
    const fixture = TestBed.createComponent(IconComponent);
    fixture.componentRef.setInput('name', 'chevron-right');
    fixture.componentRef.setInput('size', 16);
    fixture.componentRef.setInput('stroke', 2);
    fixture.detectChanges();
    const svg = (fixture.nativeElement as HTMLElement).querySelector('svg')!;
    expect(svg.querySelectorAll('path')).toHaveLength(1);
    expect(svg.getAttribute('width')).toBe('16');
    expect(svg.getAttribute('stroke-width')).toBe('2');
    expect(svg.style.transform).toContain('rotate(-90deg)');
  });

  it('renders filled glyphs with currentColor', () => {
    const fixture = TestBed.createComponent(IconComponent);
    fixture.componentRef.setInput('name', 'plus');
    fixture.detectChanges();
    const path = (fixture.nativeElement as HTMLElement).querySelector('path')!;
    expect(path.getAttribute('fill')).toBe('currentColor');
  });
});
