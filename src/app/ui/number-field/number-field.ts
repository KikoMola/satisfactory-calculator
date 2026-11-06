import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import {
  NgpNumberField,
  NgpNumberFieldDecrement,
  NgpNumberFieldIncrement,
  NgpNumberFieldInput,
} from 'ng-primitives/number-field';

/** Number input with −/+ buttons (Angular Primitives `ngpNumberField`), styled with Tailwind. */
@Component({
  selector: 'app-number-field',
  hostDirectives: [
    {
      directive: NgpNumberField,
      inputs: [
        'ngpNumberFieldValue:value',
        'ngpNumberFieldMin:min',
        'ngpNumberFieldMax:max',
        'ngpNumberFieldStep:step',
        'ngpNumberFieldLargeStep:largeStep',
        'ngpNumberFieldDisabled:disabled',
      ],
      outputs: ['ngpNumberFieldValueChange:valueChange'],
    },
  ],
  imports: [NgpNumberFieldInput, NgpNumberFieldIncrement, NgpNumberFieldDecrement],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class:
      'inline-flex h-7 items-center overflow-hidden rounded-md border border-line bg-canvas ' +
      'text-sm text-fg focus-within:border-accent',
  },
  template: `
    <button
      ngpNumberFieldDecrement
      type="button"
      class="grid h-full w-6 cursor-pointer place-items-center text-muted data-hover:bg-hover
        data-hover:text-fg data-disabled:cursor-not-allowed data-disabled:opacity-40"
      [attr.aria-label]="'Reducir ' + label()"
    >
      −
    </button>
    <input
      ngpNumberFieldInput
      class="h-full w-10 min-w-0 bg-transparent text-center tabular-nums outline-none"
      [attr.aria-label]="label()"
    />
    @if (suffix()) {
      <span class="pr-1 text-xs text-muted" aria-hidden="true">{{ suffix() }}</span>
    }
    <button
      ngpNumberFieldIncrement
      type="button"
      class="grid h-full w-6 cursor-pointer place-items-center text-muted data-hover:bg-hover
        data-hover:text-fg data-disabled:cursor-not-allowed data-disabled:opacity-40"
      [attr.aria-label]="'Aumentar ' + label()"
    >
      +
    </button>
  `,
})
export class NumberField {
  /** Accessible name of the input, e.g. "velocidad de reloj". */
  readonly label = input.required<string>();
  /** Unit shown after the number, e.g. "%". */
  readonly suffix = input('');
}
