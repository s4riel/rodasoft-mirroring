import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FileDropzoneComponent } from './file-dropzone.component';

@Component({
  imports: [FileDropzoneComponent],
  template: `<rs-file-dropzone
    title="Arrastra tus fotos"
    formatsLabel="Formatos:"
    formats="JPG, PNG"
    limit="Máx. 5 MB"
    buttonLabel="Seleccionar"
    multiple
    [disabled]="disabled"
    (filesSelected)="picked = $event"
  />`,
})
class HostComponent {
  disabled = false;
  picked: File[] = [];
}

describe('FileDropzoneComponent', () => {
  const setup = () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  };
  const drop = (el: HTMLElement, files: File[]) => {
    const event = new Event('drop', { bubbles: true, cancelable: true }) as Event & { dataTransfer: unknown };
    event.dataTransfer = { files };
    el.querySelector('.zone')?.dispatchEvent(event);
  };

  it('shows the title, the formats, the limit and the button', () => {
    const { el } = setup();
    expect(el.querySelector('.title')?.textContent).toContain('Arrastra tus fotos');
    expect(el.querySelector('.meta strong')?.textContent).toBe('JPG, PNG');
    expect(el.textContent).toContain('Máx. 5 MB');
    expect(el.querySelector('.pick')?.textContent).toContain('Seleccionar');
  });

  it('reports the files dropped on it', () => {
    const { fixture, el } = setup();
    const file = new File(['x'], 'a.png', { type: 'image/png' });
    drop(el, [file]);
    expect(fixture.componentInstance.picked).toEqual([file]);
  });

  it('ignores drops and disables the button while disabled', () => {
    const { fixture, el } = setup();
    fixture.componentInstance.disabled = true;
    fixture.changeDetectorRef.markForCheck();
    fixture.detectChanges();
    drop(el, [new File(['x'], 'a.png')]);
    expect(fixture.componentInstance.picked).toEqual([]);
    expect((el.querySelector('.pick') as HTMLButtonElement).disabled).toBe(true);
  });
});
