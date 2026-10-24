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

@Component({
  imports: [TextareaDirective],
  template: `<textarea id="auto" rsTextarea autosize rows="3">una línea</textarea><textarea id="plain" rsTextarea></textarea>`,
})
class AutosizeHostComponent {}

describe('TextareaDirective autosize', () => {
  it('has no scrollbar or resize handle and sets its own height; a plain one keeps the browser behaviour', async () => {
    const fixture = TestBed.createComponent(AutosizeHostComponent);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const auto = el.querySelector('#auto') as HTMLTextAreaElement;
    const plain = el.querySelector('#plain') as HTMLTextAreaElement;
    expect(auto.style.overflowY).toBe('hidden');
    expect(auto.style.resize).toBe('none');
    expect(auto.style.height).not.toBe('');
    expect(plain.style.overflowY).toBe('');
    expect(plain.style.height).toBe('');
  });
});
