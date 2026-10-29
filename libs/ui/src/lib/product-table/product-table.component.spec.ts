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
    expect(el.querySelectorAll('rs-stock-flag[data-level="out"]')).toHaveLength(1);
  });

  it('draws the status with a glyph (check / warning), none for inactive, and the category glyph on the thumb', () => {
    const el: HTMLElement = setup([
      row({ id: 'a' }),
      row({ id: 'b', availability: 'out', thumbIcon: 'droplet' }),
      row({ id: 'c', availability: 'inactive' }),
    ]).nativeElement;
    const pills = Array.from(el.querySelectorAll('.status'));
    expect(pills[0].querySelector('rs-icon')).not.toBeNull();
    expect(pills[1].getAttribute('data-availability')).toBe('out');
    expect(pills[1].querySelector('rs-icon')).not.toBeNull();
    expect(pills[2].querySelector('rs-icon')).toBeNull();
    expect(el.querySelectorAll('rs-product-thumb')[1].querySelector('rs-icon')).not.toBeNull();
  });

  it('shows the country name even when the country has no flag', () => {
    const el: HTMLElement = setup([row({ country: null, countryName: 'Austria' })]).nativeElement;
    expect(el.querySelector('.brand rs-flag')).toBeNull();
    expect(el.querySelector('.brand .country-name')?.textContent).toContain('Austria');
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

  it('closes the menu with Escape and returns focus to the kebab button', () => {
    const fixture = setup([row({})], { menuItems: [{ key: 'view', label: 'Ver detalles', icon: 'eye' }] });
    const el: HTMLElement = fixture.nativeElement;
    document.body.appendChild(el);
    const kebab = el.querySelector('.kebab') as HTMLButtonElement;
    kebab.click();
    fixture.detectChanges();
    expect(el.querySelector('rs-row-menu')).not.toBeNull();

    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    expect(el.querySelector('rs-row-menu')).toBeNull();
    expect(document.activeElement).toBe(kebab);
    el.remove();
  });

  it('names the table and hides the empty header cell from assistive tech', () => {
    const el: HTMLElement = setup([row({})], { tableLabel: 'Productos' }).nativeElement;
    expect(el.querySelector('[role="table"]')?.getAttribute('aria-label')).toBe('Productos');
    expect(el.querySelector('.header .cell:last-child')?.getAttribute('aria-hidden')).toBe('true');
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
