import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NoteComponent } from './note.component';

@Component({
  imports: [NoteComponent],
  template: `
    <rs-note type="danger" title="Error">Algo falló</rs-note>
    <rs-note>Información</rs-note>
  `,
})
class HostComponent {}

describe('NoteComponent', () => {
  it('usa role alert en danger y status en el resto', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    const notes: HTMLElement[] = Array.from(fixture.nativeElement.querySelectorAll('rs-note'));
    expect(notes[0].getAttribute('role')).toBe('alert');
    expect(notes[0].querySelector('strong')?.textContent).toBe('Error');
    expect(notes[0].textContent).toContain('Algo falló');
    expect(notes[1].getAttribute('role')).toBe('status');
    expect(notes[1].getAttribute('data-type')).toBe('info');
    expect(notes[1].querySelector('strong')).toBeNull();
  });
});
