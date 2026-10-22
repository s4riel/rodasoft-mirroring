import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { RadioCardComponent, RadioCardGroupComponent } from './radio-card.component';

@Component({
  imports: [RadioCardComponent, RadioCardGroupComponent, FormsModule],
  template: `
    <rs-radio-card-group [(ngModel)]="choice">
      <rs-radio-card value="pickup" label="Retiro" description="En sucursal" />
      <rs-radio-card value="delivery" label="Envío" />
      <rs-radio-card value="locked" label="Bloqueada" [disabled]="true" />
    </rs-radio-card-group>
    <rs-radio-card id="solo" label="Suelta" [(checked)]="solo" />
  `,
})
class HostComponent {
  choice = 'pickup';
  readonly solo = signal(false);
}

describe('RadioCardComponent', () => {
  it('refleja el valor del grupo y cambia al hacer clic', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    await fixture.whenStable();
    const cards: HTMLElement[] = Array.from(fixture.nativeElement.querySelectorAll('rs-radio-card'));
    expect(cards[0].getAttribute('aria-checked')).toBe('true');
    expect(cards[1].getAttribute('aria-checked')).toBe('false');

    cards[1].click();
    await fixture.whenStable();
    expect(fixture.componentInstance.choice).toBe('delivery');
    expect(cards[1].getAttribute('aria-checked')).toBe('true');
    expect(cards[0].getAttribute('aria-checked')).toBe('false');
  });

  it('ignora clics cuando está deshabilitada', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    const cards: HTMLElement[] = Array.from(fixture.nativeElement.querySelectorAll('rs-radio-card'));
    cards[2].click();
    await fixture.whenStable();
    expect(cards[2].getAttribute('aria-disabled')).toBe('true');
    expect(cards[2].getAttribute('aria-checked')).toBe('false');
  });

  it('funciona sin grupo con [(checked)]', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    const solo = fixture.nativeElement.querySelector('#solo') as HTMLElement;
    solo.click();
    await fixture.whenStable();
    expect(fixture.componentInstance.solo()).toBe(true);
    expect(solo.getAttribute('aria-checked')).toBe('true');
  });
});
