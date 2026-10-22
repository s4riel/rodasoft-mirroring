import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ToastOutletComponent } from './toast-outlet.component';
import { ToastComponent } from './toast.component';
import { ToastService } from './toast.service';

@Component({
  imports: [ToastComponent],
  template: `<rs-toast type="success" heading="Listo" (dismissed)="closed = true">Guardado</rs-toast>`,
})
class HostComponent {
  closed = false;
}

describe('ToastComponent', () => {
  it('muestra título, mensaje y emite al cerrar', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    const el: HTMLElement = fixture.nativeElement.querySelector('rs-toast');
    expect(el.getAttribute('data-type')).toBe('success');
    expect(el.querySelector('strong')?.textContent).toBe('Listo');
    expect(el.textContent).toContain('Guardado');
    (el.querySelector('button.close') as HTMLButtonElement).click();
    expect(fixture.componentInstance.closed).toBe(true);
  });
});

describe('ToastService + outlet', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('encola, renderiza y descarta por temporizador', async () => {
    const service = TestBed.inject(ToastService);
    const fixture = TestBed.createComponent(ToastOutletComponent);
    service.success('Guardado', { duration: 1000 });
    service.danger('Falló', { duration: 0 });
    fixture.detectChanges(); // not whenStable(): the zoneless scheduler's timers are faked in this suite
    expect(fixture.nativeElement.querySelectorAll('rs-toast').length).toBe(2);

    jest.advanceTimersByTime(1000);
    fixture.detectChanges();
    expect(service.toasts().length).toBe(1);
    expect(fixture.nativeElement.querySelectorAll('rs-toast').length).toBe(1);

    service.clear();
    expect(service.toasts().length).toBe(0);
  });

  it('dismiss elimina un toast concreto', () => {
    const service = TestBed.inject(ToastService);
    const a = service.info('A', { duration: 0 });
    service.info('B', { duration: 0 });
    service.dismiss(a);
    expect(service.toasts().map((t) => t.message)).toEqual(['B']);
  });
});
