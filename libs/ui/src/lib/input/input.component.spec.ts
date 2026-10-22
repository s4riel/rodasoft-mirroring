import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { InputDirective, InputGroupComponent } from './input.component';

@Component({
  imports: [InputDirective, InputGroupComponent],
  template: `
    <input id="a" rsInput placeholder="6205-2RS" />
    <input id="b" rsInput invalid />
    <rs-input-group id="g" invalid>
      <span rsInputLeading id="lead">L</span>
      <input id="c" rsInput />
      <span rsInputTrailing id="trail">T</span>
    </rs-input-group>
  `,
})
class HostComponent {}

describe('InputDirective / InputGroupComponent', () => {
  async function render() {
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  it('aplica la clase rs-input sin aria-invalid por defecto', async () => {
    const el = (await render()).querySelector('#a') as HTMLInputElement;
    expect(el.classList).toContain('rs-input');
    expect(el.getAttribute('aria-invalid')).toBeNull();
  });

  it('refleja invalid en aria-invalid', async () => {
    const el = (await render()).querySelector('#b') as HTMLInputElement;
    expect(el.getAttribute('aria-invalid')).toBe('true');
  });

  it('el grupo proyecta ícono inicial, input e ícono final en orden', async () => {
    const group = (await render()).querySelector('#g') as HTMLElement;
    expect(group.classList).toContain('rs-input-group--invalid');
    const ids = Array.from(group.children).map((c) => c.id);
    expect(ids).toEqual(['lead', 'c', 'trail']);
  });
});
