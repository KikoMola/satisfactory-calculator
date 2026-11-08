import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { NgpListbox, NgpListboxOption } from 'ng-primitives/listbox';
import { ItemIcon } from '../../../ui/item-icon/item-icon';
import type { SelectOption } from '../../../ui/select/select';
import { SPECIAL_SORT_RULES, type SortRule } from '../planner.model';

const SPECIAL_IDS = new Set<string>(SPECIAL_SORT_RULES.map((r) => r.id));

/**
 * Sort rules of one smart/programmable splitter output, shown inside a popover: a search box
 * and a list with the special rules and every solid item. A smart splitter picks one rule
 * (choosing closes the popover); a programmable one toggles as many as needed.
 */
@Component({
  selector: 'app-sort-rules',
  imports: [ItemIcon, NgpListbox, NgpListboxOption],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class:
      'absolute z-50 flex w-64 flex-col gap-2 rounded-lg border border-line bg-panel p-2 text-sm text-fg ' +
      'shadow-xl shadow-black/40 outline-none',
  },
  template: `
    <p class="m-0 px-1 text-xs font-semibold" [id]="id() + '-title'">{{ title() }}</p>
    <input
      type="search"
      class="h-8 rounded-md border border-line bg-canvas px-2 text-sm text-fg outline-none
        placeholder:text-muted focus-visible:border-accent"
      placeholder="Buscar objeto…"
      [attr.aria-label]="'Buscar en ' + title()"
      [attr.aria-controls]="id() + '-list'"
      [value]="query()"
      (input)="query.set($any($event.target).value)"
    />
    <div
      ngpListbox
      class="max-h-72 overflow-y-auto outline-none"
      [id]="id() + '-list'"
      [attr.aria-labelledby]="id() + '-title'"
      [ngpListboxMode]="multiple() ? 'multiple' : 'single'"
      [ngpListboxValue]="rules()"
      (ngpListboxValueChange)="onChange($event)"
    >
      @for (option of visibleOptions(); track option.value) {
        <div
          ngpListboxOption
          [ngpListboxOptionValue]="option.value"
          class="flex h-8 cursor-pointer items-center gap-2 rounded-md px-2
            data-active:bg-hover data-hover:bg-hover data-selected:font-semibold"
        >
          @if (option.icon !== undefined) {
            <app-item-icon [src]="option.icon" [size]="16" />
          } @else {
            <span class="grid size-4 place-items-center text-muted" aria-hidden="true">{{
              symbol(option.value)
            }}</span>
          }
          <span class="truncate">{{ option.label }}</span>
          <svg
            class="ml-auto size-4 shrink-0 text-accent"
            [class.invisible]="!rules().includes(option.value)"
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
        <p class="m-0 px-2 py-1 text-xs text-muted">Ningún objeto coincide.</p>
      }
    </div>
  `,
})
export class SortRules {
  /** Unique prefix for element IDs. */
  readonly id = input.required<string>();
  /** Heading, e.g. "Filtro de la salida izquierda". */
  readonly title = input.required<string>();
  readonly rules = input.required<SortRule[]>();
  readonly options = input.required<readonly SelectOption[]>();
  /** Programmable splitter: several rules per output. */
  readonly multiple = input(false);

  readonly rulesChange = output<SortRule[]>();
  /** A smart splitter rule was picked: the popover can close. */
  readonly done = output<void>();

  protected readonly query = signal('');

  /** Special rules always stay; items are filtered by the search text. */
  protected readonly visibleOptions = computed(() => {
    const query = normalize(this.query().trim());
    return this.options().filter(
      (o) => SPECIAL_IDS.has(o.value) || !query || normalize(o.label).includes(query),
    );
  });

  protected symbol(rule: SortRule): string {
    return SPECIAL_SORT_RULES.find((r) => r.id === rule)?.symbol ?? '';
  }

  protected onChange(rules: SortRule[]) {
    this.rulesChange.emit(rules);
    if (!this.multiple()) this.done.emit();
  }
}

/** Lower case without accents, so "lingote" finds "Lingote de hierro" and "acero" "Acero". */
function normalize(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}
