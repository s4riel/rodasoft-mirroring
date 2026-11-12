import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { RequestCardComponent } from './request-card.component';

@Component({
  imports: [RequestCardComponent],
  template: `
    <rs-request-card
      kicker="Devolución"
      title="DEV-000012 · V-000231"
      description="Ana Cajera · Falla de fábrica"
      detail="El cliente trajo el rodamiento roto"
      amount="− Bs 200,00"
      tone="negative"
    >
      <div slot="actions"><button class="decide" type="button">Aprobar</button></div>
    </rs-request-card>
    <rs-request-card title="T-0142" />
  `,
})
class HostComponent {}

describe('RequestCardComponent', () => {
  async function render() {
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    return Array.from<HTMLElement>(fixture.nativeElement.querySelectorAll('rs-request-card'));
  }

  it('shows the kind, the title, who asked, what they wrote and the amount', async () => {
    const [full] = await render();
    expect(full.querySelector('.kicker')?.textContent).toBe('Devolución');
    expect(full.querySelector('.title')?.textContent).toBe('DEV-000012 · V-000231');
    expect(full.querySelector('.description')?.textContent).toBe('Ana Cajera · Falla de fábrica');
    expect(full.querySelector('.detail')?.textContent).toBe('El cliente trajo el rodamiento roto');
    expect(full.querySelector('.amount')?.textContent).toBe('− Bs 200,00');
  });

  it('projects the actions', async () => {
    const [full, bare] = await render();
    expect(full.querySelector('.actions .decide')?.textContent).toBe('Aprobar');
    expect(bare.querySelector('.actions .decide')).toBeNull();
  });

  it('leaves out what it was not given', async () => {
    const [, bare] = await render();
    expect(bare.querySelector('.kicker')).toBeNull();
    expect(bare.querySelector('.description')).toBeNull();
    expect(bare.querySelector('.detail')).toBeNull();
    expect(bare.querySelector('.amount')).toBeNull();
  });

  it('is a labelled group and mirrors the tone', async () => {
    const [full, bare] = await render();
    expect(full.getAttribute('role')).toBe('group');
    expect(full.getAttribute('aria-label')).toBe('DEV-000012 · V-000231');
    expect(full.getAttribute('data-tone')).toBe('negative');
    expect(bare.getAttribute('data-tone')).toBe('neutral');
  });
});
