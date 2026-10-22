import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { EmptyStateIllustratedComponent } from './empty-state-illustrated.component';
import { EmptyStateComponent } from './empty-state.component';
import { IllustrationComponent } from './illustration.component';
import { ILLUSTRATION_NAMES } from './illustrations';

@Component({
  imports: [EmptyStateComponent, EmptyStateIllustratedComponent, IllustrationComponent],
  template: `
    <rs-empty-state heading="Sin resultados" description="Prueba otro término"><button id="a">Limpiar</button></rs-empty-state>
    <rs-empty-state-illustrated id="page" illustration="no-access" heading="Sin acceso" description="Pide permiso"
      ><button id="b">Solicitar</button></rs-empty-state-illustrated
    >
    <rs-empty-state-illustrated id="inline" size="inline" [showAction]="false" illustration="error" heading="Error"
      ><button id="c">Reintentar</button></rs-empty-state-illustrated
    >
    @for (n of names; track n) {
      <rs-illustration [name]="n" />
    }
  `,
})
class HostComponent {
  readonly names = ILLUSTRATION_NAMES;
}

describe('EmptyState', () => {
  it('renderiza título, descripción y acciones del estado base', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    const el: HTMLElement = fixture.nativeElement.querySelector('rs-empty-state');
    expect(el.querySelector('.title')?.textContent).toBe('Sin resultados');
    expect(el.querySelector('.description')?.textContent).toBe('Prueba otro término');
    expect(el.querySelector('#a')).not.toBeNull();
  });

  it('la variante ilustrada respeta tamaño, ilustración y ShowAction', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    const root: HTMLElement = fixture.nativeElement;
    const page = root.querySelector('#page') as HTMLElement;
    const inline = root.querySelector('#inline') as HTMLElement;
    expect(page.getAttribute('data-size')).toBe('page');
    expect(page.querySelector('rs-illustration')?.getAttribute('data-name')).toBe('no-access');
    expect(page.querySelector('#b')).not.toBeNull();
    expect(inline.getAttribute('data-size')).toBe('inline');
    expect(inline.querySelector('#c')).toBeNull();
  });

  it('dibuja las 14 ilustraciones', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    expect(ILLUSTRATION_NAMES.length).toBe(14);
    const svgs = fixture.nativeElement.querySelectorAll('rs-illustration > svg');
    for (const svg of Array.from(svgs) as SVGElement[]) {
      expect(svg.querySelectorAll('*').length).toBeGreaterThan(3);
    }
  });
});
