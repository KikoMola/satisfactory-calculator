import { ChangeDetectionStrategy, Component } from '@angular/core';

/** Small "×" icon used by delete buttons. Decorative: the button carries the label. */
@Component({
  selector: 'app-icon-close',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
  template: `
    <svg
      class="size-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      aria-hidden="true"
    >
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  `,
})
export class IconClose {}

/** Clockwise arrow used by "rotate" buttons. Decorative: the button carries the label. */
@Component({
  selector: 'app-icon-rotate',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
  template: `
    <svg
      class="size-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M20 12a8 8 0 1 1-2.34-5.66" />
      <path d="M20 4v5h-5" />
    </svg>
  `,
})
export class IconRotate {}
