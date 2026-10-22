import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ALL_BRANCHES, BranchOption, ContextBarComponent } from './context-bar.component';

const BRANCHES: BranchOption[] = [
  { id: 'b1', name: 'Sucursal central' },
  { id: 'b2', name: 'Sucursal norte' },
];

@Component({
  imports: [ContextBarComponent],
  template: `
    <rs-context-bar
      company="Rodalaser S.R.L."
      companyLabel="Empresa"
      branchLabel="Sucursal"
      allLabel="Todas las sucursales"
      description="Empresa definida por la URL"
      [branches]="branches()"
      [allowAll]="allowAll()"
      [(branchId)]="branchId"
    >
      <button rsContextActions>Salir</button>
    </rs-context-bar>
  `,
})
class HostComponent {
  branches = signal<BranchOption[]>(BRANCHES);
  allowAll = signal(true);
  branchId = signal<string>(ALL_BRANCHES);
}

describe('ContextBarComponent', () => {
  it('Branch=All: offers all branches and the options', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.company .strong')?.textContent).toContain('Rodalaser S.R.L.');
    const options = el.querySelectorAll('option');
    expect(options.length).toBe(3);
    expect(options[0].textContent).toContain('Todas las sucursales');
    expect((el.querySelector('select') as HTMLSelectElement).value).toBe(ALL_BRANCHES);
    expect(el.querySelector('rs-context-bar')?.getAttribute('data-branch')).toBe('all');
    expect(el.querySelector('.description')?.textContent).toContain('URL');
    expect(el.querySelector('.actions')?.textContent).toContain('Salir');
  });

  it('emits the selected branch', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    const select = fixture.nativeElement.querySelector('select') as HTMLSelectElement;
    select.value = 'b2';
    select.dispatchEvent(new Event('change'));
    await fixture.whenStable();
    expect(fixture.componentInstance.branchId()).toBe('b2');
  });

  it('Branch=Multiple has no "all" option; Branch=Single has no selector', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.allowAll.set(false);
    await fixture.whenStable();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelectorAll('option').length).toBe(2);
    expect(el.querySelector('rs-context-bar')?.getAttribute('data-branch')).toBe('multiple');
    fixture.componentInstance.branches.set([BRANCHES[0]]);
    await fixture.whenStable();
    expect(el.querySelector('select')).toBeNull();
    expect(el.querySelector('.branch .strong')?.textContent).toContain('Sucursal central');
    expect(el.querySelector('rs-context-bar')?.getAttribute('data-branch')).toBe('single');
  });
});
