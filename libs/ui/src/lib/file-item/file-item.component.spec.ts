import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FileItemComponent, type FileItemStatus } from './file-item.component';

@Component({
  imports: [FileItemComponent],
  template: `<rs-file-item
    name="RT-3552_v1.jpg"
    detail="3,5 MB · 36 s restantes"
    removeLabel="Cancelar subida"
    [status]="status"
    [progress]="progress"
    (removed)="removed = removed + 1"
  />`,
})
class HostComponent {
  status: FileItemStatus = 'uploading';
  progress = 40;
  removed = 0;
}

describe('FileItemComponent', () => {
  const setup = () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  };

  it('shows the name, the detail and the progress while uploading', () => {
    const { el } = setup();
    expect(el.querySelector('.name')?.textContent).toBe('RT-3552_v1.jpg');
    expect(el.querySelector('.detail')?.textContent).toContain('36 s restantes');
    expect(el.querySelector('.percent')?.textContent).toBe('40%');
    expect(el.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('40');
  });

  it('keeps the percentage between 0 and 100', () => {
    const { fixture, el } = setup();
    fixture.componentInstance.progress = 140;
    fixture.changeDetectorRef.markForCheck();
    fixture.detectChanges();
    expect(el.querySelector('.percent')?.textContent).toBe('100%');
  });

  it('hides the progress bar once the file is done', () => {
    const { fixture, el } = setup();
    fixture.componentInstance.status = 'done';
    fixture.changeDetectorRef.markForCheck();
    fixture.detectChanges();
    expect(el.querySelector('.progress')).toBeNull();
  });

  it('emits removed from the button, named for assistive tech', () => {
    const { fixture, el } = setup();
    const button = el.querySelector('.remove') as HTMLButtonElement;
    expect(button.getAttribute('aria-label')).toBe('Cancelar subida');
    button.click();
    expect(fixture.componentInstance.removed).toBe(1);
  });
});
