import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';

export interface BreadcrumbItem {
  label: string;
  /** Router link. Without it (or on the last item) the level is plain text. */
  link?: string;
  disabled?: boolean;
}

/**
 * Figma: Breadcrumb Levels=3|4 x State (Default/Hover/Pressed/Focus/Disabled).
 * Levels = number of items; the last one is the current page (label/md, text/primary).
 * Hover/Pressed/Focus are CSS only; Disabled per item.
 */
@Component({
  selector: 'rs-breadcrumb',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './breadcrumb.component.html',
  styleUrl: './breadcrumb.component.scss',
})
export class BreadcrumbComponent {
  readonly items = input.required<readonly BreadcrumbItem[]>();
  /** Accessible name of the navigation landmark (Spanish copy lives in the app). */
  readonly label = input('');
}
