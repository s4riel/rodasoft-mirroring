import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TextareaDirective } from './textarea.component';

@Component({
  imports: [TextareaDirective],
  template: `
    <textarea id="a" rsTextarea>hola</textarea>
    <textarea id="b" rsTextarea invalid disabled></textarea>
  `,
})
class HostComponent {}

describe('TextareaDirective', () => {
  async function render() {
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  it('aplica la clase rs-textarea', async () => {
    const el = (await render()).querySelector('#a') as HTMLTextAreaElement;
    expect(el.classList).toContain('rs-textarea');
    expect(el.getAttribute('aria-invalid')).toBeNull();
    expect(el.value).toBe('hola');
  });

  it('refleja invalid y disabled', async () => {
    const el = (await render()).querySelector('#b') as HTMLTextAreaElement;
    expect(el.getAttribute('aria-invalid')).toBe('true');
    expect(el.disabled).toBe(true);
  });
});
