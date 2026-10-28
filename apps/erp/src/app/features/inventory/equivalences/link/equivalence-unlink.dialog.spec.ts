import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ToastService } from '@rodasoft/ui';
import { EquivalenceUnlinkDialog, type UnlinkTarget } from './equivalence-unlink.dialog';

const URL = '/api/v1/inventory/equivalences/e1';
const TARGET: UnlinkTarget = { id: 'e1', pairLabel: '6205-2RS · SKF y 6205-DDU · NSK' };

@Component({
  imports: [EquivalenceUnlinkDialog],
  template: `<rs-equivalence-unlink-dialog [(open)]="open" [target]="target" (unlinked)="unlinked.set($event)" />`,
})
class HostComponent {
  readonly open = signal(true);
  readonly target = TARGET;
  readonly unlinked = signal<string | null>(null);
}

describe('EquivalenceUnlinkDialog', () => {
  let http: HttpTestingController;

  async function setup() {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const button = (label: string) => Array.from(el.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent?.trim().includes(label))!;
    const settle = async () => {
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
    };
    return { el, button, settle, host: fixture.componentInstance };
  }

  afterEach(() => http.verify());

  it('asks first, names the pair and says the products are untouched', async () => {
    const { el } = await setup();
    expect(el.textContent).toContain('¿Desvincular equivalencia?');
    expect(el.textContent).toContain('6205-2RS · SKF y 6205-DDU · NSK');
    expect(el.textContent).toContain('Los productos y su stock no cambian');
    http.expectNone(URL);
  });

  it('removes the link on confirm, closes, tells the screen and shows the toast', async () => {
    const { button, settle, host } = await setup();
    const success = jest.spyOn(TestBed.inject(ToastService), 'success');
    button('Desvincular').click();
    const req = http.expectOne(URL);
    expect(req.request.method).toBe('DELETE');
    req.flush(null, { status: 204, statusText: 'No Content' });
    await settle();
    expect(host.open()).toBe(false);
    expect(host.unlinked()).toBe('e1');
    expect(success).toHaveBeenCalledWith('Equivalencia desvinculada');
  });

  it('closes on Cancelar without calling the API', async () => {
    const { button, settle, host } = await setup();
    button('Cancelar').click();
    await settle();
    expect(host.open()).toBe(false);
    expect(host.unlinked()).toBeNull();
  });

  it('shows the error and stays open when it fails', async () => {
    const { el, button, settle, host } = await setup();
    button('Desvincular').click();
    http.expectOne(URL).flush({ code: 'ERROR', message: 'boom' }, { status: 500, statusText: 'Error' });
    await settle();
    expect(el.querySelector('rs-note[data-type=danger]')?.textContent).toContain('boom');
    expect(host.open()).toBe(true);
    expect(host.unlinked()).toBeNull();
  });

  it('treats a link that is already gone as done, so the list refreshes', async () => {
    const { button, settle, host } = await setup();
    button('Desvincular').click();
    http.expectOne(URL).flush({ code: 'EQUIVALENCE_NOT_FOUND', message: 'x' }, { status: 404, statusText: 'Not Found' });
    await settle();
    expect(host.open()).toBe(false);
    expect(host.unlinked()).toBe('e1');
  });
});
