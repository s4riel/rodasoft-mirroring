import { TestBed } from '@angular/core/testing';
import { formatBoliviano, ProductTableComponent, ProductTableLabels, ProductTableRow } from './product-table.component';

const labels: ProductTableLabels = {
  photo: 'Foto',
  code: 'Código',
  product: 'Producto',
  description: 'Descripción',
  totalStock: 'Stock total',
  branchStock: 'En sucursal',
  price: 'Precio (Bs)',
  status: 'Estado',
  rowActions: 'Acciones de',
  availability: { available: 'Disponible', low: 'Stock bajo', out: 'Agotado', inactive: 'Inactivo' },
};

const row = (over: Partial<ProductTableRow>): ProductTableRow => ({
  id: 'p1',
  photoUrl: null,
  code: '6205-2RS',
  name: 'Rodamiento rígido',
  brandName: 'SKF',
  brandLogoUrl: null,
  country: 'SE',
  description: 'Bolas, 25×52×15 mm',
  totalStock: 60,
  branchStock: 24,
  price: '1150.50',
  availability: 'available',
  ...over,
});

describe('formatBoliviano', () => {
  it('groups thousands with dots and uses a decimal comma', () => {
    expect(formatBoliviano('245.00')).toBe('245,00');
    expect(formatBoliviano('1150.5')).toBe('1.150,50');
    expect(formatBoliviano('1234567.89')).toBe('1.234.567,89');
  });
});

describe('ProductTableComponent', () => {
  function setup(rows: ProductTableRow[], extra: Record<string, unknown> = {}) {
    const fixture = TestBed.createComponent(ProductTableComponent);
    fixture.componentRef.setInput('rows', rows);
    fixture.componentRef.setInput('labels', labels);
    for (const [k, v] of Object.entries(extra)) fixture.componentRef.setInput(k, v);
    fixture.detectChanges();
    return fixture;
  }

  it('renders a row per product with brand initials, price format and availability', () => {
    const el: HTMLElement = setup([row({}), row({ id: 'p2', availability: 'out', branchStock: 0, brandName: 'NSK' })]).nativeElement;
    expect(el.querySelectorAll('.row:not(.header)')).toHaveLength(2);
    expect(el.textContent).toContain('1.150,50');
    expect(el.textContent).toContain('Disponible');
    expect(el.textContent).toContain('Agotado');
    expect(el.querySelector('.initials')?.textContent?.trim()).toBe('SK');
    expect(el.querySelectorAll('.alert.danger')).toHaveLength(1);
  });

  it('shows the brand logo instead of the initials when there is one', () => {
    const el: HTMLElement = setup([row({ brandLogoUrl: 'https://img.test/skf.svg' })]).nativeElement;
    expect(el.querySelector('img.logo')).not.toBeNull();
    expect(el.querySelector('.initials')).toBeNull();
  });

  it('has no row menu button without menu items', () => {
    const el: HTMLElement = setup([row({})]).nativeElement;
    expect(el.querySelector('.kebab')).toBeNull();
  });

  it('opens the row menu, emits the chosen action and closes', () => {
    const fixture = setup([row({})], { menuItems: [{ key: 'view', label: 'Ver detalles', icon: 'eye' }] });
    const el: HTMLElement = fixture.nativeElement;
    const emitted: { id: string; key: string }[] = [];
    fixture.componentInstance.rowAction.subscribe((e) => emitted.push(e));

    (el.querySelector('.kebab') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(el.querySelector('rs-row-menu')).not.toBeNull();

    (el.querySelector('[role="menuitem"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(emitted).toEqual([{ id: 'p1', key: 'view' }]);
    expect(el.querySelector('rs-row-menu')).toBeNull();
  });

  it('closes the menu with a click outside', () => {
    const fixture = setup([row({})], { menuItems: [{ key: 'view', label: 'Ver detalles', icon: 'eye' }] });
    const el: HTMLElement = fixture.nativeElement;
    (el.querySelector('.kebab') as HTMLButtonElement).click();
    fixture.detectChanges();
    document.body.click();
    fixture.detectChanges();
    expect(el.querySelector('rs-row-menu')).toBeNull();
  });

  it('shows the footer only when it has a label', () => {
    const fixture = setup([row({})]);
    expect(fixture.nativeElement.querySelector('.footer')).toBeNull();
    fixture.componentRef.setInput('footerLabel', 'Subtotal');
    fixture.componentRef.setInput('footerBranchStock', 24);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.footer')?.textContent).toContain('Subtotal');
  });
});
