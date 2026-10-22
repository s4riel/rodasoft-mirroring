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
  templateUrl: './avatar.component.html',
  styleUrl: './avatar.component.scss',
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
