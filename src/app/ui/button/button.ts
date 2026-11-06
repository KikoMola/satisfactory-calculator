import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { NgpButton } from 'ng-primitives/button';

const BASE =
  'inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-md ' +
  'transition-colors data-press:translate-y-px ' +
  'data-disabled:cursor-not-allowed data-disabled:opacity-50';

const VARIANTS = {
  primary: 'h-8 px-3.5 text-sm font-semibold bg-accent text-on-accent data-hover:bg-accent-hover',
  icon: 'size-8 text-muted data-hover:bg-hover data-hover:text-fg',
  'icon-sm': 'size-6 rounded text-muted data-hover:bg-hover data-hover:text-fg',
} as const;

/** Button built on Angular Primitives (`ngpButton`), styled with Tailwind. */
@Component({
  selector: 'button[appButton]',
  hostDirectives: [{ directive: NgpButton, inputs: ['disabled'] }],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class]': 'classes()' },
  template: '<ng-content />',
})
export class Button {
  readonly variant = input<keyof typeof VARIANTS>('primary');

  protected readonly classes = computed(() => `${BASE} ${VARIANTS[this.variant()]}`);
}
