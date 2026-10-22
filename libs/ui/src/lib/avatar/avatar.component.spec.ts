import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AvatarComponent } from './avatar.component';

@Component({
  imports: [AvatarComponent],
  template: `
    <rs-avatar initials="RA" name="Rosa Aguilar" size="sm" />
    <rs-avatar src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" initials="JP" />
  `,
})
class HostComponent {}

describe('AvatarComponent', () => {
  it('muestra iniciales o imagen según src', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    const avatars: HTMLElement[] = Array.from(fixture.nativeElement.querySelectorAll('rs-avatar'));
    expect(avatars[0].getAttribute('data-type')).toBe('initials');
    expect(avatars[0].getAttribute('data-size')).toBe('sm');
    expect(avatars[0].getAttribute('aria-label')).toBe('Rosa Aguilar');
    expect(avatars[0].textContent).toContain('RA');
    expect(avatars[1].getAttribute('data-type')).toBe('image');
    expect(avatars[1].querySelector('img')).not.toBeNull();
  });
});
