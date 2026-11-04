import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import qrcode from 'qrcode-generator';

/** Error correction of the QR: `M` recovers about 15 % of a damaged code, the usual choice for a screen. */
export type QrCodeLevel = 'L' | 'M' | 'Q' | 'H';

/** Modules of white drawn around the code; the QR standard asks for 4 so that scanners find its edges. */
const QUIET_ZONE = 4;

/**
 * A QR code drawn as one SVG path (HU-VEN-08). It encodes `payload` and fills the square it is given, so the parent sets the
 * size. It is always black on white, whatever the theme: scanners need that contrast, and a dark theme would break them.
 * Not in Figma as a component yet: flagged as "estimated" in `docs/ui-library.md`.
 *   <rs-qr-code payload="RODASOFT-MOCK|ref|490.00" label="Código QR de pago" />
 */
@Component({
  selector: 'rs-qr-code',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { role: 'img', '[attr.aria-label]': 'label()' },
  templateUrl: './qr-code.component.html',
  styleUrl: './qr-code.component.scss',
})
export class QrCodeComponent {
  /** The text the QR encodes. */
  readonly payload = input.required<string>();
  /** What assistive technology says for the picture; the app writes it in Spanish. */
  readonly label = input<string>('');
  readonly level = input<QrCodeLevel>('M');

  /** The dark modules as `M x y h1 v1 h-1 z` squares of one path, with the quiet zone as the origin. */
  protected readonly code = computed(() => {
    const qr = qrcode(0, this.level());
    qr.addData(this.payload());
    qr.make();
    const count = qr.getModuleCount();
    let path = '';
    for (let row = 0; row < count; row++)
      for (let col = 0; col < count; col++) if (qr.isDark(row, col)) path += `M${col + QUIET_ZONE} ${row + QUIET_ZONE}h1v1h-1z`;
    const size = count + QUIET_ZONE * 2;
    return { path, viewBox: `0 0 ${size} ${size}`, size };
  });
}
