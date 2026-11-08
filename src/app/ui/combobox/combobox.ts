import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import {
  NgpCombobox,
  NgpComboboxButton,
  NgpComboboxDropdown,
  NgpComboboxInput,
  NgpComboboxOption,
  NgpComboboxPortal,
} from 'ng-primitives/combobox';
import { ItemIcon } from '../item-icon/item-icon';
import { matchesSearch } from '../search';
import type { SelectOption } from '../select/select';

/**
 * Searchable single-value select (autocomplete) built on Angular Primitives (`ngpCombobox`),
 * styled like `app-select`. Typing filters the options by label and hint; closing without
 * picking puts the selected label back. A value is always required: it can't be cleared.
 */
@Component({
  selector: 'app-combobox',
  imports: [
    ItemIcon,
    NgpCombobox,
    NgpComboboxButton,
    NgpComboboxDropdown,
    NgpComboboxInput,
    NgpComboboxOption,
    NgpComboboxPortal,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block min-w-0' },
  template: `
    <div
      ngpCombobox
      class="group flex h-8 min-w-0 items-center gap-2 rounded-md border border-line bg-canvas pl-2
        text-sm text-fg transition-colors data-hover:border-muted data-open:border-accent
        data-focus:border-accent"
      [ngpComboboxValue]="value()"
      [ngpComboboxAllowDeselect]="false"
      (ngpComboboxValueChange)="onValueChange($event)"
      (ngpComboboxOpenChange)="onOpenChange($event)"
    >
      @if (selected(); as option) {
        @if (option.icon || option.color) {
          <app-item-icon [src]="option.icon" [color]="option.color ?? ''" />
        }
      }
      <input
        ngpComboboxInput
        class="h-full min-w-0 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-muted"
        [value]="text()"
        [placeholder]="placeholder()"
        [attr.aria-label]="label()"
        (input)="onInput($event)"
        (focus)="selectAll($event)"
      />
      @if (selected()?.hint && !filtering()) {
        <span class="shrink-0 text-xs text-muted tabular-nums">{{ selected()!.hint }}</span>
      }
      <button
        ngpComboboxButton
        type="button"
        class="grid h-full w-7 shrink-0 cursor-pointer place-items-center text-muted"
        [attr.aria-label]="'Mostrar opciones de ' + label()"
        tabindex="-1"
      >
        <svg
          class="size-4 transition-transform group-data-open:rotate-180"
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
      </button>

      <div
        *ngpComboboxPortal
        ngpComboboxDropdown
        class="absolute z-50 mt-1 max-h-72 w-(--ngp-combobox-width) min-w-44 overflow-y-auto rounded-lg
          border border-line bg-panel p-1 text-sm text-fg shadow-xl shadow-black/40 outline-none
          origin-(--ngp-combobox-transform-origin) data-enter:animate-[select-in_100ms_ease-out]
          motion-reduce:animate-none"
      >
        @for (option of visibleOptions(); track option.value) {
          <div
            ngpComboboxOption
            [ngpComboboxOptionValue]="option.value"
            class="flex h-8 cursor-pointer items-center gap-2 rounded-md px-2
              data-active:bg-hover data-hover:bg-hover data-press:bg-hover data-selected:font-semibold"
          >
            @if (option.icon || option.color) {
              <app-item-icon [src]="option.icon" [color]="option.color ?? ''" />
            }
            <span class="truncate">{{ option.label }}</span>
            @if (option.hint) {
              <span class="ml-auto shrink-0 pl-3 text-xs text-muted tabular-nums">
                {{ option.hint }}
              </span>
            }
            <svg
              class="size-4 shrink-0 text-accent"
              [class.invisible]="option.value !== value()"
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
        } @empty {
          <p class="m-0 px-2 py-1.5 text-xs text-muted">Nada coincide con «{{ text() }}».</p>
        }
      </div>
    </div>
  `,
})
export class Combobox {
  readonly options = input.required<readonly SelectOption[]>();
  readonly value = input.required<string>();
  /** Accessible name of the input, e.g. "Receta". */
  readonly label = input.required<string>();
  readonly placeholder = input('Buscar…');

  readonly valueChange = output<string>();

  protected readonly selected = computed(
    () => this.options().find((o) => o.value === this.value()) ?? null,
  );

  /** What the user typed; `null` while not searching (the input shows the selected label). */
  private readonly query = signal<string | null>(null);
  protected readonly filtering = computed(() => this.query() !== null);
  protected readonly text = computed(() => this.query() ?? this.selected()?.label ?? '');

  /** Typed text matches the label or the hint ("alt", "evento"). */
  protected readonly visibleOptions = computed(() => {
    const query = this.query();
    if (!query) return this.options();
    return this.options().filter((o) => matchesSearch(`${o.label} ${o.hint ?? ''}`, query));
  });

  protected onInput(event: Event) {
    this.query.set((event.target as HTMLInputElement).value);
  }

  /** Selecting the text on focus lets typing replace it straight away. */
  protected selectAll(event: FocusEvent) {
    (event.target as HTMLInputElement).select();
  }

  protected onValueChange(value: string | null) {
    this.query.set(null);
    if (value !== null && value !== this.value()) this.valueChange.emit(value);
  }

  /** Closing without picking shows the selected option again. */
  protected onOpenChange(open: boolean) {
    if (!open) this.query.set(null);
  }
}
