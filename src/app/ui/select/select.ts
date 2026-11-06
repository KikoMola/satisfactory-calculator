import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import {
  injectSelectState,
  NgpSelect,
  NgpSelectDropdown,
  NgpSelectOption,
  NgpSelectPortal,
} from 'ng-primitives/select';

export interface SelectOption {
  value: string;
  label: string;
  /** Optional colour dot shown before the label. */
  color?: string;
  /** Optional secondary text shown on the right (e.g. "60/min"). */
  hint?: string;
}

/**
 * Single-value select built on Angular Primitives (`ngpSelect`).
 * Label it by wrapping it in `ngpFormField` with an `ngpLabel` sibling.
 */
@Component({
  selector: 'app-select',
  imports: [NgpSelectDropdown, NgpSelectOption, NgpSelectPortal],
  hostDirectives: [
    {
      directive: NgpSelect,
      inputs: ['ngpSelectValue:value', 'ngpSelectDisabled:disabled'],
      outputs: ['ngpSelectValueChange:valueChange'],
    },
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class:
      'group flex min-w-0 cursor-pointer items-center gap-2 rounded-md border border-line bg-canvas ' +
      'px-2 text-fg transition-colors select-none ' +
      'data-hover:border-muted data-open:border-accent ' +
      'data-disabled:cursor-not-allowed data-disabled:opacity-50',
    '[class.h-8]': "size() === 'md'",
    '[class.text-sm]': "size() === 'md'",
    '[class.h-7]': "size() === 'sm'",
    '[class.text-xs]': "size() === 'sm'",
  },
  template: `
    <span class="flex min-w-0 flex-1 items-center gap-2">
      @if (selected(); as option) {
        @if (option.color) {
          <span
            class="size-2.5 shrink-0 rounded-full"
            [style.background]="option.color"
            aria-hidden="true"
          ></span>
        }
        <span class="truncate">{{ option.label }}</span>
        @if (option.hint && showHint()) {
          <span class="ml-auto shrink-0 text-muted tabular-nums">{{ option.hint }}</span>
        }
      } @else {
        <span class="truncate text-muted">{{ placeholder() }}</span>
      }
    </span>

    <svg
      class="size-4 shrink-0 text-muted transition-transform group-data-open:rotate-180"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>

    <div
      *ngpSelectPortal
      ngpSelectDropdown
      class="absolute z-50 mt-1 max-h-72 w-(--ngp-select-width) min-w-44 overflow-y-auto rounded-lg
        border border-line bg-panel p-1 text-sm text-fg shadow-xl shadow-black/40 outline-none
        origin-(--ngp-select-transform-origin) data-enter:animate-[select-in_100ms_ease-out]
        motion-reduce:animate-none"
    >
      @for (option of options(); track option.value) {
        <div
          ngpSelectOption
          [ngpSelectOptionValue]="option.value"
          class="flex h-8 cursor-pointer items-center gap-2 rounded-md px-2
            data-active:bg-hover data-press:bg-hover data-selected:font-semibold"
        >
          @if (option.color) {
            <span
              class="size-2.5 shrink-0 rounded-full"
              [style.background]="option.color"
              aria-hidden="true"
            ></span>
          }
          <span class="truncate">{{ option.label }}</span>
          @if (option.hint) {
            <span class="ml-auto shrink-0 pl-3 text-xs text-muted tabular-nums">
              {{ option.hint }}
            </span>
          }
          <svg
            class="size-4 shrink-0 text-accent"
            [class.invisible]="option.value !== state().value()"
            [class.ml-auto]="!option.hint"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.5"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M20 6 9 17l-5-5" />
          </svg>
        </div>
      }
    </div>
  `,
})
export class Select {
  protected readonly state = injectSelectState<string>();

  readonly options = input.required<readonly SelectOption[]>();
  readonly placeholder = input('Selecciona…');
  readonly size = input<'md' | 'sm'>('md');
  /** Show the selected option's hint inside the trigger, not only in the list. */
  readonly showHint = input(false);

  protected readonly selected = computed(() => {
    const value = this.state().value();
    return this.options().find((option) => option.value === value) ?? null;
  });
}
