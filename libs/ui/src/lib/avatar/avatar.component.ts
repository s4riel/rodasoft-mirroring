import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';

export type AvatarSize = 'sm' | 'md';
export type AvatarType = 'initials' | 'image';

/**
 * Avatar (Figma: Avatar Type=Initials|Image, Size=SM|MD).
 * Pass `src` to show an image (falls back to initials if it fails to load); otherwise `initials`.
 */
@Component({
  selector: 'rs-avatar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[attr.data-size]': 'size()',
    '[attr.data-type]': 'type()',
    '[attr.role]': 'name() ? "img" : null',
    '[attr.aria-label]': 'name() || null',
  },
  template: `
    @if (type() === 'image') {
      <img [src]="src()" alt="" (error)="failed.set(true)" />
    } @else {
      <span class="initials" aria-hidden="true">{{ initials() }}</span>
    }
  `,
  styles: `
    :host {
      display: inline-flex;
      flex: none;
      align-items: center;
      justify-content: center;
      overflow: hidden;
      width: 32px; /* SM */
      height: 32px;
      border-radius: var(--radius-full);
      background: var(--action-primary-soft);
      color: var(--text-primary);
      font-size: var(--body-sm-size);
      font-weight: 600;
      line-height: 1;
      user-select: none;
    }
    :host([data-size='md']) { width: 40px; height: 40px; font-size: var(--body-md-size); }
    img { width: 100%; height: 100%; object-fit: cover; display: block; }
  `,
})
export class AvatarComponent {
  readonly size = input<AvatarSize>('md');
  readonly src = input<string | null | undefined>(null);
  readonly initials = input<string>('');
  /** Accessible name (person's name). */
  readonly name = input<string>('');

  protected readonly failed = signal(false);
  protected readonly type = computed<AvatarType>(() => (this.src() && !this.failed() ? 'image' : 'initials'));
}
